import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const origin = "https://pocketsense-local-color-lab.zq20021102mia.chatgpt.site";
const target = "https://qizhang1102.github.io/Pocket_Sense/";
const html = await readFile(new URL("index.html", import.meta.url), "utf8");
const worker = await readFile(new URL("sw.js", import.meta.url), "utf8");

function setup(clients = []) {
  const handlers = {};
  const deleted = [];
  let claimed = false;
  let skipped = false;
  runInNewContext(worker, {
    URL, Response,
    caches: { keys: async () => ["pocketsense-1234567890abcdef", "another-app", "pocketsense-user-data"], delete: async (name) => deleted.push(name) },
    self: {
      registration: { scope: origin + "/" },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; }, matchAll: async () => clients },
      addEventListener: (name, handler) => { handlers[name] = handler; },
    },
  });
  return { handlers, deleted, state: () => ({ claimed, skipped }) };
}

test("old page replaces history and keeps only supported hashes, without query data", () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [hash, expected] of [["#ph", "#ph"], ["#color", "#color"], ["#home", "#home"], ["#about", "#about"], ["#notebook", ""], ["#https://example.com", ""]]) {
    let actual;
    runInNewContext(script, { location: { hash, search: "?token=private", replace: (url) => { actual = url; } }, navigator: {} });
    assert.equal(actual, target + expected);
  }
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /href="https:\/\/qizhang1102.github.io\/Pocket_Sense\/"/);
});

test("migration takes over old cached tabs and isolates unrelated storage and clients", async () => {
  const navigated = [];
  const { handlers, deleted, state } = setup([
    { url: origin + "/?token=private#ph", navigate: async (url) => { navigated.push(url); } },
    { url: origin + "/", navigate: async () => { throw Error("closed tab"); } },
    { url: "https://example.com/", navigate: async () => { throw Error("unrelated tab must not navigate"); } },
  ]);
  let pending;
  handlers.install({ waitUntil: (value) => { pending = value; } });
  await pending;
  handlers.activate({ waitUntil: (value) => { pending = value; } });
  await pending;
  assert.deepEqual(state(), { claimed: true, skipped: true });
  assert.deepEqual(deleted, ["pocketsense-1234567890abcdef"]);
  assert.deepEqual(navigated, [target + "#ph"]);
});

test("navigation redirects only legacy pages and never intercepts assets or POST", async () => {
  const { handlers } = setup();
  const checks = [
    { url: origin + "/?token=private#color", mode: "navigate", method: "GET", redirect: true },
    { url: target, mode: "navigate", method: "GET", redirect: false },
    { url: origin + "/image.png", mode: "cors", method: "GET", redirect: false },
    { url: origin + "/", mode: "navigate", method: "POST", redirect: false },
  ];
  for (const request of checks) {
    let response;
    handlers.fetch({ request, respondWith: (value) => { response = value; } });
    assert.equal(Boolean(response), request.redirect);
    if (response) { assert.equal(response.status, 302); assert.equal(response.headers.get("location"), target + "#color"); }
  }
});
