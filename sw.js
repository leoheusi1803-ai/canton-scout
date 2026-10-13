/* ============================================================
   sw.js — service worker. É isto que faz o app abrir sem
   internet nenhuma, dentro do pavilhão da feira.
   ============================================================ */
const CACHE = 'canton-scout-v4';

/* tudo que precisa estar no aparelho antes de embarcar */
const ESSENCIAL = [
  './',
  'index.html',
  'guia.html',
  'app.css',
  'js/db.js',
  'js/dados.js',
  'js/custos.js',
  'js/ui.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/fiscal.json',
  'data/anuencia.json',
  'data/antidumping.json',
  'data/produtos.json',
  'data/visao.json',
  'data/imagenet-labels.json',
  'js/visao.js',
  'js/tf.min.js',
  'modelo/model.json',
  'modelo/group1-shard1of4',
  'modelo/group1-shard2of4',
  'modelo/group1-shard3of4',
  'modelo/group1-shard4of4'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falha inteiro se um item falhar: baixa um por um e segue
      .then(c => Promise.all(ESSENCIAL.map(u =>
        c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* cache primeiro: offline é o caso normal, não a exceção */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return res;
      }).catch(() =>
        // navegação sem rede e sem cache: devolve o app
        req.mode === 'navigate' ? caches.match('index.html') : new Response('', { status: 504 })
      );
    })
  );
});

/* a página pode perguntar se a base já está toda cacheada */
self.addEventListener('message', (e) => {
  if (e.data === 'estado-cache') {
    caches.open(CACHE).then(c => c.keys()).then(ks => {
      e.source.postMessage({ tipo: 'estado-cache', total: ks.length, esperado: ESSENCIAL.length });
    });
  }
});
