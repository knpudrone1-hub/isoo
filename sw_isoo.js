const CACHE_NAME = "isoo-math-kitty-v12";
const ASSETS = [
  "./index_isoo.html",
  "./style_isoo.css",
  "./script_isoo.js",
  "./manifest_isoo.json",
  "./kitty_app_icon.png",
  "./kitty_planner_header.png",
  "./kitty_sticker_happy.png",
  "./kitty_sticker_studying.png",
  "./cat_head.png",
  "./favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
