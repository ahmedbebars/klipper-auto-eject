/* klipper-auto-eject web page: the service worker that makes it an app.
 *
 * It keeps a copy of the page's own files so the app opens even when the
 * printer cannot be reached, and shows that it is offline. Everything live
 * (Moonraker, the camera, G-code files) always comes from the printer.
 * The network is tried first, so an update of the page shows at once.
 */
"use strict";

const CACHE = "auto-eject-v1";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "model.js", "moonraker.js", "demo.js",
  "lang/en.js", "lang/ar.js", "manifest.json",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];
// the page's files sit under /auto-eject/: web/, config/, docs/images/;
// the farm's live answers and camera pictures (api/) are never kept
const ROOT = new URL("../", self.registration.scope).pathname;
const API = ROOT + "api/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// A notification from the printer's notification service (Web Push), shown
// even while the app is closed.
self.addEventListener("push", (event) => {
  let note = {};
  try { note = event.data ? event.data.json() : {}; } catch (e) { note = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(note.title || "Auto-eject", {
    body: note.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: note.tag || "auto-eject", renotify: true, data: { url: note.url || self.registration.scope }
  }));
});

// Tapping a notification brings the app to the front, on the tab it names
// (a farm printer's opens the farm), or opens it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        client.postMessage({ type: "open", url });
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(ROOT) || url.pathname.startsWith(API)) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && response.type === "basic" && !request.headers.has("range")) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true })
    .then((hit) => hit || (request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
