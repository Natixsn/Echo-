/* Écho — service worker.

   Une seule chose à faire à chaque déploiement : changer VERSION ci-dessous.
   L'ancien cache est alors supprimé et tout le monde bascule sur la nouvelle
   version au lancement suivant, sans avoir à réinstaller quoi que ce soit.

   La page elle-même est servie réseau d'abord : une mise à jour est donc prise
   tout de suite dès qu'il y a du réseau, et le cache ne sert que hors ligne.
   C'est ce qui évite de laisser des utilisateurs bloqués sur une vieille
   version — le défaut classique des service workers. */

const VERSION = 'echo-2026-10-01c';
const PAGE = './index.html';
const SHELL = ['./', PAGE, './manifest.json', './mp4box.min.js',
               './icon-192.png', './icon-512.png'];
const NET_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    /* Un fichier manquant ne doit pas faire échouer toute l'installation. */
    await Promise.all(SHELL.map(u =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [VERSION, VERSION + '-fonts'];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => keep.indexOf(k) < 0).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function fromNetwork(req, ms){
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    fetch(req, { cache: 'no-store' }).then(
      r => { clearTimeout(t); res(r); },
      err => { clearTimeout(t); rej(err); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch(err){ return; }

  /* La police vient de Google. Sans elle, hors ligne, c'est celle du système
     qui s'affiche — plus large, et la mise en page s'en ressent. On la garde
     donc en mémoire dès la première visite. */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith((async () => {
      const c = await caches.open(VERSION + '-fonts');
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        if (net && (net.ok || net.type === 'opaque')) c.put(req, net.clone());
        return net;
      } catch(err){
        return hit || new Response('', { status: 504 });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* La page : réseau d'abord, cache en secours. */
  if (req.mode === 'navigate' || req.destination === 'document'){
    e.respondWith((async () => {
      try {
        const net = await fromNetwork(req, NET_TIMEOUT);
        if (net && net.ok){
          const c = await caches.open(VERSION);
          c.put(PAGE, net.clone());
        }
        return net;
      } catch(err){
        const hit = await caches.match(PAGE) || await caches.match('./');
        return hit || new Response('Hors ligne, et aucune version en mémoire.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  /* Le reste : cache d'abord, puisque la version fige son contenu. */
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      if (net && net.ok && net.type === 'basic'){
        const c = await caches.open(VERSION);
        c.put(req, net.clone());
      }
      return net;
    } catch(err){
      return new Response('', { status: 504 });
    }
  })());
});
