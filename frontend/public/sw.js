// Service worker de Ma Corsa-e : affiche les notifications envoyées par le serveur.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Ma Corsa-e", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/media/icon-192.png",
      badge: "/media/icon-192.png",
      data: { url: data.url || "/corsa" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/corsa";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          // appli déjà ouverte : lui demander d'afficher l'écran visé (ex. ?view=releases)
          w.postMessage({ type: "open", url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
