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

  /* Foto, cartão e áudio ficam guardados como bytes (ArrayBuffer), não
     como Blob. No iPhone o Blob gravado no IndexedDB vira um arquivo à
     parte, que o sistema pode descartar: o registro continua lá, mas a
     imagem não abre mais — foi o "?" nas miniaturas da v20. Os bytes
     ficam dentro do próprio banco, junto com o resto do produto.       */
  function lerBytes(blob) {
    const leitura = blob.arrayBuffer ? blob.arrayBuffer() : new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = () => erro(fr.error);
      fr.readAsArrayBuffer(blob);
    });
    // arquivo que o sistema já apagou às vezes nem responde: não trava o app
    return Promise.race([leitura,
      new Promise((_, erro) => setTimeout(() => erro(new Error('não respondeu')), 8000))]);
  }
  function paraGuardar(m) {
    if (!m.blob) return Promise.resolve(m);
    return lerBytes(m.blob).then(bytes => {
      const r = Object.assign({}, m, { bytes, tipo: m.tipo || m.blob.type || '' });
      delete r.blob;
      return r;
    });
  }
  // devolve com .blob, como o resto do app espera; o que se perdeu fica de fora
  function deGuardado(r) {
    if (r.bytes) {
      const m = Object.assign({}, r, { blob: new Blob([r.bytes], { type: r.tipo || '' }) });
      delete m.bytes;
      return m;
    }
    return r.blob && !r.perdida ? r : null;
  }
  const midiasCruas = (produtoId) => tx('midias', 'readonly')
    .then(s => pedir(s.index('produtoId').getAll(produtoId)));

  const api = {
    novoId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),

    salvarProduto: (p) => tx('produtos', 'readwrite').then(s => pedir(s.put(p))),
    lerProduto:    (id) => tx('produtos', 'readonly').then(s => pedir(s.get(id))),
    listarProdutos: () => tx('produtos', 'readonly').then(s => pedir(s.getAll())),
    apagarProduto: (id) => tx('produtos', 'readwrite').then(s => pedir(s.delete(id)))
      .then(() => midiasCruas(id))
      .then(ms => Promise.all(ms.map(m => api.apagarMidia(m.id)))),

    // os bytes são lidos ANTES de abrir a transação: esperar dentro dela a fecharia
    salvarMidia: (m) => paraGuardar(m).then(r => tx('midias', 'readwrite').then(s => pedir(s.put(r)))),
    apagarMidia: (id) => tx('midias', 'readwrite').then(s => pedir(s.delete(id))),
    midiasDe: (produtoId) => midiasCruas(produtoId).then(rs => rs.map(deGuardado).filter(Boolean)),
    todasMidias: () => tx('midias', 'readonly').then(s => pedir(s.getAll()))
      .then(rs => rs.map(deGuardado).filter(Boolean)),

    /* Passa para bytes o que ainda está guardado como Blob (até a v20).
       O que não dá mais para ler fica marcado como perdido, para a tela
       explicar em vez de mostrar "?". Devolve { convertidas, perdidas }. */
    migrarMidias: () => tx('midias', 'readonly').then(s => pedir(s.getAll())).then(rs => {
      const velhas = rs.filter(r => r.blob && !r.bytes && !r.perdida);
      const rel = { convertidas: 0, perdidas: 0 };
      return velhas.reduce((fila, r) => fila.then(() =>
        paraGuardar(r)
          .then(novo => { rel.convertidas++; return novo; })
          .catch(() => { rel.perdidas++; return Object.assign({}, r, { perdida: true }); })
          .then(novo => tx('midias', 'readwrite').then(s => pedir(s.put(novo))))
      ), Promise.resolve()).then(() => rel);
    }),

    /* para o autoteste: quantas fotos ainda abrem, quantas o iPhone perdeu */
    saudeMidias: () => tx('midias', 'readonly').then(s => pedir(s.getAll())).then(rs => ({
      boas: rs.filter(r => r.bytes || (r.blob && !r.perdida)).length,
      perdidas: rs.filter(r => r.perdida).length
    })),

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
