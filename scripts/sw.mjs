import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name),
      ),
    )
  ).flat();
}
const paths = (await files("dist")).filter((p) => !p.endsWith("sw.js"));
const revision = createHash("sha256");
for (const path of paths.sort()) revision.update(await readFile(path));
const urls = paths.map((p) => "./" + p.slice(5));
await writeFile(
  "dist/sw.js",
  `const CACHE='pocketsense-${revision.digest("hex").slice(0, 16)}';
const ASSETS=${JSON.stringify(["./", ...urls])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pocketsense-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 const known=ASSETS.some(a=>new URL(a,self.registration.scope).pathname===url.pathname);
 if(event.request.mode==='navigate')event.respondWith(caches.open(CACHE).then(cache=>cache.match('./index.html')).then(hit=>hit||fetch(event.request)));
 else if(known)event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(hit=>hit||fetch(event.request)));
});
`,
);
console.log(`Offline shell: ${urls.length} fingerprinted resources.`);
