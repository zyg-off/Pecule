// Foyer Pécule · service worker : la page s'ouvre même sans réseau, et les rappels du jour (tâches, péremptions,
// congélateur) s'affichent en notification, y compris appli fermée quand le téléphone le permet (Chrome Android,
// appli installée). Aucune donnée n'est envoyée : le rappel se calcule à partir du planning que la page a laissé
// sur le téléphone.
const CACHE = "pecule-v5";
const SHELL = ["foyer.html", "foyer.webmanifest", "foyer-icon-192.png", "foyer-zxing.min.js"];

// chaque fichier séparément : un fichier absent ne doit pas empêcher de garder les autres
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((f) => c.add(f).catch(() => {}))))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

// page : réseau d'abord (toujours la dernière version), copie gardée pour le hors-ligne
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // « no-cache » : on redemande toujours au serveur si la page a changé (sinon le navigateur peut garder
  // l'ancienne version jusqu'à 10 minutes) ; si rien n'a changé, la réponse est quasi instantanée.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("foyer.html"))));
});

// petit stockage partagé avec la page (IndexedDB)
function db() { return new Promise((ok, ko) => { const r = indexedDB.open("pecule", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); }
async function kv(key, value) {
  const d = await db();
  return new Promise((ok, ko) => { const t = d.transaction("kv", value === undefined ? "readonly" : "readwrite"), s = t.objectStore("kv");
    const r = value === undefined ? s.get(key) : s.put(value, key); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function remind() {
  const plan = (await kv("plan")) || [], shown = (await kv("shown")) || {}, today = ymd(new Date());
  const due = plan.filter((x) => x.day <= today && x.until >= today && !shown[x.key]);
  if (!due.length) return;
  for (const x of due) shown[x.key] = today;
  await kv("shown", Object.fromEntries(Object.entries(shown).filter(([, d]) => d >= ymd(new Date(Date.now() - 30 * 864e5)))));
  const groups = {};
  due.forEach((x) => (groups[x.group] = groups[x.group] || []).push(x.text));
  for (const [g, texts] of Object.entries(groups)) {
    await self.registration.showNotification(g, { body: texts.slice(0, 5).join("\n"), icon: "foyer-icon-192.png", badge: "foyer-icon-192.png", tag: g, data: { url: "foyer.html" } });
  }
}
self.addEventListener("periodicsync", (e) => { if (e.tag === "pecule-daily") e.waitUntil(remind()); });
self.addEventListener("message", (e) => { if (e.data === "remind") e.waitUntil(remind()); });
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => cs.length ? cs[0].focus() : self.clients.openWindow("foyer.html")));
});
