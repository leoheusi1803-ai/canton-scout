/* ============================================================
   sw.js — service worker. É isto que faz o app abrir sem
   internet nenhuma, dentro do pavilhão da feira.
   ============================================================ */
const CACHE = 'canton-scout-v23';

/* tudo que precisa estar no aparelho antes de embarcar */
const ESSENCIAL = [
  './',
  'index.html',
  'guia.html',
  'comecar.html',
  'qr.html',
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
  'data/precos.json',
  'data/visao.json',
  'data/imagenet-labels.json',
  'js/visao.js',
  'js/sync.js',
  'js/ia.js',
  'js/qrcode.min.js',
  'js/tf.min.js',
  'modelo/model.json',
  'modelo/group1-shard1of4',
  'modelo/group1-shard2of4',
  'modelo/group1-shard3of4',
  'modelo/group1-shard4of4'
];

/* A atualização chega com a pessoa já na China, por VPN ou roaming fraco.
   Se um arquivo não baixar, reaproveita a cópia da versão anterior — senão
   o activate apagaria o cache velho e o app perderia, por exemplo, o
   modelo da foto, sem ninguém perceber até ficar offline.
   'no-cache' revalida: o que não mudou volta como 304, sem baixar de novo. */
function guardar(c, u) {
  return fetch(new Request(u, { cache: 'no-cache' }))
    .then(res => { if (!res.ok) throw new Error(res.status); return c.put(u, res); })
    .catch(() => caches.match(u, { ignoreSearch: true })
      .then(velho => velho ? c.put(u, velho) : null))
    .catch(() => null);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ESSENCIAL.map(u => guardar(c, u))))
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
