import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openLocalDatabase, serve } from "./local.mjs";
import worker from "./worker.mjs";

const origin = "http://127.0.0.1:4173";
const feedback = { category: "feature", feature: "calibration", message: "Add a chart guide.", email: "fixture@example.invalid", rating: 4 };
const key = randomBytes(32).toString("hex");
const bearer = { Authorization: "Bearer " + key };

function request(path, method, data, headers = {}) {
  return new Request("http://127.0.0.1" + path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

function fixture(t) {
  const db = openLocalDatabase(":memory:");
  t.after(db.close);
  return { DB: db.DB, OWNER_TOKEN: key, ALLOWED_ORIGINS: origin };
}

test("submit, retrieve, update, restart, and recover through actual HTTP and persistent SQLite", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pocketsense-feedback-"));
  const filename = join(dir, "db.sqlite");
  let server;
  const open = async () => {
    server = await serve({ filename, token: key, port: 0 });
    return "http://127.0.0.1:" + server.address().port;
  };
  const close = async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
    server = undefined;
  };
  t.after(async () => {
    if (server) await close();
    await rm(dir, { recursive: true, force: true });
  });
  let base = await open();
  const errorResponse = await fetch(base + "/admin/feedback");
  assert.equal(errorResponse.status, 401);
  assert.doesNotMatch(await errorResponse.text(), /fixture@/);
  const retryKey = randomUUID();
  const post = await fetch(base + "/feedback", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": retryKey }, body: JSON.stringify(feedback),
  });
  assert.equal(post.status, 201);
  assert.equal(post.headers.get("access-control-allow-origin"), origin);
  const result = await post.json();
  assert.deepEqual(Object.keys(result), ["id"]);
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  const changed = await fetch(base + "/admin/feedback/" + result.id, {
    method: "PATCH", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({ status: "reviewing" }),
  });
  assert.equal(changed.status, 200);
  await close();
  base = await open();
  const retry = await fetch(base + "/feedback", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": retryKey },
    body: JSON.stringify(feedback),
  });
  assert.equal(retry.status, 201);
  assert.deepEqual(await retry.json(), result);
  const list = await fetch(base + "/admin/feedback?feature=calibration&category=feature&status=reviewing", { headers: bearer });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("cache-control"), "no-store");
  const { items } = await list.json();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { ...feedback, id: result.id, createdAt: items[0].createdAt, status: "reviewing" });
  assert.ok(Number.isFinite(Date.parse(items[0].createdAt)));
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.deepEqual(db.prepare("PRAGMA table_info(feedback)").all().map((r) => r.name),
      ["id", "createdAt", "category", "feature", "message", "email", "rating", "status"]);
  } finally { db.close(); }
});

test("routes require the correct method and owner key", async (t) => {
  const env = fixture(t);
  const { id } = await (await worker.fetch(request("/feedback", "POST", feedback), env)).json();
  for (const [path, method, body, headers, status] of [
    ["/feedback", "GET", undefined, {}, 405],
    ["/feedback/" + id, "GET", undefined, {}, 404],
    ["/admin/feedback", "GET", undefined, {}, 401],
    ["/admin/feedback", "GET", undefined, { Authorization: "Bearer " + randomBytes(32).toString("hex") }, 401],
    ["/admin/feedback/" + id, "PATCH", { status: "reviewing" }, {}, 401],
    ["/admin/feedback/" + id, "DELETE", undefined, bearer, 405],
    ["/admin/feedback/" + id, "PATCH", { status: "invented" }, bearer, 400],
    ["/admin/feedback/" + id, "PATCH", { status: "planned", email: "new@example.invalid" }, bearer, 400],
    ["/feedback", "POST", feedback, { Origin: "https://unlisted.example" }, 403],
    ["/feedback", "POST", feedback, { "Content-Type": "text/plain" }, 415],
  ]) {
    const response = await worker.fetch(request(path, method, body, headers), env);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /fixture@/);
  }
  const preflight = await worker.fetch(request("/admin/feedback", "OPTIONS"), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET");
  const page = await (await worker.fetch(request("/admin/feedback", "GET", undefined, bearer), env)).json();
  assert.equal(page.items[0].status, "new");
});

test("accepts only intended fields and size limits, never stores rejected submissions", async (t) => {
  const env = fixture(t);
  for (const fields of [
    { category: "other" }, { ...feedback, message: " " }, { ...feedback, message: "x".repeat(4001) },
    { ...feedback, category: "unlisted" }, { ...feedback, feature: "unlisted" }, { ...feedback, rating: 0 },
    { ...feedback, rating: "5" }, { ...feedback, rating: 6 }, { ...feedback, email: "invalid" },
    { ...feedback, website: "bot" }, { ...feedback, photo: "ignored?" }, { ...feedback, ph: 7 },
    { ...feedback, profile: [{ label: "private" }] }, [],
  ]) assert.equal((await worker.fetch(request("/feedback", "POST", fields), env)).status, 400);
  assert.equal((await worker.fetch(request("/feedback", "POST", { message: "x".repeat(30000) }), env)).status, 413);
  const page = await (await worker.fetch(request("/admin/feedback", "GET", undefined, bearer), env)).json();
  assert.deepEqual(page, { items: [], nextOffset: null });
});

test("creates only the allowed number of records in a concurrent burst", async (t) => {
  const env = fixture(t);
  const calls = await Promise.all(Array.from({ length: 16 }, () =>
    worker.fetch(request("/feedback", "POST", feedback), env)));
  assert.equal(calls.filter((r) => r.status === 201).length, 12);
  assert.equal(calls.filter((r) => r.status === 429).length, 4);
  const result = await (await worker.fetch(request("/admin/feedback", "GET", undefined, bearer), env)).json();
  assert.equal(result.items.length, 12);
});

test("paginates with deterministic date order and combines filters", async (t) => {
  const env = fixture(t);
  for (let i = 0; i < 103; i++) {
    env.DB.prepare("INSERT INTO feedback(id,createdAt,category,feature,message,status) VALUES(?,?,?,?,?,?)")
      .bind(String(i), new Date(i * 60000).toISOString(), "bug", "ph", "fixture", i === 0 ? "planned" : "new").run();
  }
  const read = async (query) => (await worker.fetch(request("/admin/feedback?" + query, "GET", undefined, bearer), env)).json();
  const first = await read("sort=oldest");
  assert.equal(first.items[0].id, "0");
  assert.equal(first.nextOffset, 100);
  const second = await read("sort=oldest&offset=100");
  assert.deepEqual(second.items.map((r) => r.id), ["100", "101", "102"]);
  assert.equal(second.nextOffset, null);
  assert.deepEqual((await read("sort=newest")).items.slice(0, 2).map((r) => r.id), ["102", "101"]);
  assert.equal((await read("category=bug&feature=ph&status=planned")).items.length, 1);
  assert.equal((await read("feature=paint")).items.length, 0);
  for (const q of ["category=invalid", "offset=-1", "sort=invalid"]) {
    assert.equal((await worker.fetch(request("/admin/feedback?" + q, "GET", undefined, bearer), env)).status, 400);
  }
});

test("missing credentials, database outage or edge overload cannot yield success", async (t) => {
  const env = fixture(t);
  for (const config of [{ ...env, OWNER_TOKEN: "" }, { ...env, DB: null }, { ...env, DB: { prepare() { throw new Error("sensitive internal details"); } } }]) {
    const response = await worker.fetch(request("/feedback", "POST", feedback), config);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sensitive|fixture@/);
  }
  const response = await worker.fetch(request("/feedback", "POST", feedback), {
    ...env, SUBMISSIONS: { limit: async ({ key }) => ({ success: key !== "feedback" }) },
  });
  assert.equal(response.status, 429);
});

test("one draft key recovers one receipt through concurrent retries, conflicts and full quotas", async (t) => {
  const env = fixture(t);
  const id = randomUUID();
  const submit = (data, retryKey) => worker.fetch(request("/feedback", "POST", data,
    retryKey ? { "Idempotency-Key": retryKey } : {}), env);
  const responses = await Promise.all(Array.from({ length: 6 }, () => submit(feedback, id)));
  for (const response of responses) {
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id });
  }
  const invalid = await submit(feedback, "not-a-draft-key");
  assert.equal(invalid.status, 400);
  const conflict = await submit({ ...feedback, message: "A different submission" }, id);
  assert.equal(conflict.status, 409);
  assert.doesNotMatch(await conflict.text(), /fixture@|chart guide/);
  for (let i = 0; i < 11; i++) assert.equal((await submit(feedback)).status, 201);
  assert.equal((await submit(feedback)).status, 429);
  assert.equal((await submit(feedback, id)).status, 201);
  const read = await worker.fetch(request("/admin/feedback", "GET", undefined, bearer), env);
  const { items } = await read.json();
  assert.equal(items.length, 12);
  assert.equal(items.filter((row) => row.id === id).length, 1);
  assert.equal(items.find((row) => row.id === id).message, feedback.message);
});
