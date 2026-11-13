// Keep this URL at /sw.js: existing v1.1 installations check it for updates.
const CANONICAL = "https://qizhang1102.github.io/Pocket_Sense/";
const SUPPORTED_HASHES = new Set(["#home", "#ph", "#color", "#about"]);
const SCOPE = new URL(self.registration.scope);

function destination(url) {
  const hash = new URL(url).hash;
  return CANONICAL + (SUPPORTED_HASHES.has(hash) ? hash : "");
}

function isLegacyPage(url) {
  const parsed = new URL(url);
  return parsed.origin === SCOPE.origin && parsed.pathname.startsWith(SCOPE.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    // Only remove the exact old app-shell cache family; retain local user records.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => /^pocketsense-[a-f0-9]{16}$/.test(name)).map((name) => caches.delete(name)));
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // One closed or navigating tab must not prevent other old tabs from moving.
    await Promise.allSettled(windows.filter((client) => isLegacyPage(client.url)).map((client) => client.navigate(destination(client.url))));
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET" && event.request.mode === "navigate" && isLegacyPage(event.request.url)) {
    event.respondWith(Response.redirect(destination(event.request.url), 302));
  }
});
