const CACHE = "meishiqiang-recipes-v14";
const appShell = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./shared/ingredient-taxonomy.mjs",
  "./data/recipes.json",
  "./data/recipes-howtocook.json",
  "./data/recipes-howtocook-batch.json",
  "./data/recipes-howtocook-imported.json",
  "./data/recipes-cunlv.json",
  "./data/recipes-mogu.json",
  "./manifest.webmanifest",
  "./assets/app-icon.svg",
  "./offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(appShell)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key !== CACHE)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html").then((cached) => cached || caches.match("./offline.html"))));
    return;
  }

  // Prefer fresh recipe data when online; preserve the last complete library
  // as the offline fallback.
  if (requestUrl.pathname.endsWith("/data/recipes.json") || requestUrl.pathname.endsWith("/data/recipes-howtocook.json") || requestUrl.pathname.endsWith("/data/recipes-howtocook-batch.json") || requestUrl.pathname.endsWith("/data/recipes-howtocook-imported.json") || requestUrl.pathname.endsWith("/data/recipes-cunlv.json") || requestUrl.pathname.endsWith("/data/recipes-mogu.json")) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
