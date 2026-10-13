/* ============================================================
   db.js — armazenamento local (IndexedDB). Funciona 100% offline.
   ============================================================ */
const DB = (() => {
  const NOME = 'canton-scout';
  const VER = 1;
  let _db = null;

  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise((ok, erro) => {
      const req = indexedDB.open(NOME, VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('produtos')) {
          const s = db.createObjectStore('produtos', { keyPath: 'id' });
          s.createIndex('criado', 'criado');
        }
        if (!db.objectStoreNames.contains('midias')) {
          const s = db.createObjectStore('midias', { keyPath: 'id' });
          s.createIndex('produtoId', 'produtoId');
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'k' });
        }
      };
      req.onsuccess = () => { _db = req.result; ok(_db); };
      req.onerror = () => erro(req.error);
    });
  }

  function tx(store, modo) {
    return abrir().then(db => db.transaction(store, modo).objectStore(store));
  }
  function pedir(r) {
    return new Promise((ok, erro) => { r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });
  }

  const api = {
    novoId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),

    salvarProduto: (p) => tx('produtos', 'readwrite').then(s => pedir(s.put(p))),
    lerProduto:    (id) => tx('produtos', 'readonly').then(s => pedir(s.get(id))),
    listarProdutos: () => tx('produtos', 'readonly').then(s => pedir(s.getAll())),
    apagarProduto: (id) => tx('produtos', 'readwrite').then(s => pedir(s.delete(id)))
      .then(() => api.midiasDe(id))
      .then(ms => Promise.all(ms.map(m => api.apagarMidia(m.id)))),

    salvarMidia: (m) => tx('midias', 'readwrite').then(s => pedir(s.put(m))),
    apagarMidia: (id) => tx('midias', 'readwrite').then(s => pedir(s.delete(id))),
    midiasDe: (produtoId) => tx('midias', 'readonly')
      .then(s => pedir(s.index('produtoId').getAll(produtoId))),
    todasMidias: () => tx('midias', 'readonly').then(s => pedir(s.getAll())),

    setCfg: (k, v) => tx('config', 'readwrite').then(s => pedir(s.put({ k, v }))),
    getCfg: (k) => tx('config', 'readonly').then(s => pedir(s.get(k))).then(r => r ? r.v : undefined),
    todaCfg: () => tx('config', 'readonly').then(s => pedir(s.getAll()))
      .then(rs => { const o = {}; rs.forEach(r => o[r.k] = r.v); return o; }),

    limparTudo: () => abrir().then(db => Promise.all(
      ['produtos', 'midias', 'config'].map(n => new Promise((ok, er) => {
        const r = db.transaction(n, 'readwrite').objectStore(n).clear();
        r.onsuccess = ok; r.onerror = () => er(r.error);
      }))
    )),

    /* quanto espaço o app está usando */
    espaco: () => (navigator.storage && navigator.storage.estimate)
      ? navigator.storage.estimate() : Promise.resolve(null)
  };
  return api;
})();
