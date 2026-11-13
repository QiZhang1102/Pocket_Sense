import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const dist = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
assert(!html.includes("/src/main.tsx"), "Publish dist, not uncompiled source");
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
assert(references.some(path => path.endsWith(".js")), "Missing compiled JavaScript");
for (const reference of references) {
  assert(reference.startsWith("./"), `Nonportable asset URL: ${reference}`);
  await access(new URL(reference, dist));
}

const worker = await readFile(new URL("sw.js", dist), "utf8");
const names = new Set();
for (const base of ["/", "/Pocket_Sense/", "/another-app/"]) {
  const listeners = {};
  const scope = {
    URL,
    self: {
      location: new URL(`https://example.org${base}sw.js`),
      addEventListener: (name, listener) => { listeners[name] = listener; },
    },
  };
  runInNewContext(worker + "\nglobalThis.config = { BASE, CACHE, ASSETS, INDEX };", scope);
  const config = scope.config;
  assert.equal(config.BASE, base);
  assert.equal(config.INDEX, `${base}index.html`);
  assert(config.ASSETS.includes(config.INDEX));
  for (const path of config.ASSETS) {
    assert(path.startsWith(base));
    assert(!path.split("/").some(part => part.startsWith(".")), "Do not precache hidden hosting metadata");
    await access(fileURLToPath(new URL(path.slice(base.length), dist)));
  }
  for (const event of ["install", "activate", "fetch"]) assert(listeners[event]);
  names.add(config.CACHE);
}
assert.equal(names.size, 3, "Separate app paths must not share cache names");
console.log("Build verified: compiled assets, root and subpath offline scopes.");
