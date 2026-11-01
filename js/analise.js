/* ============================================================
   analise.js — a conta da análise pós-feira.

   O pedido é o MOQ que vocês cadastraram (ou o "Vou pedir", quando é
   maior). O frete sai do volume desse pedido: até 15 m³ vai em carga
   fracionada; acima disso, em contêiner de 20' ou de 40', o que sair
   mais barato. O custo posto no Brasil é o da aba Custos, com o câmbio
   e as despesas da Config deste celular.

   O preço de comparação é o do produto IGUAL mais barato que já se vende
   no Brasil, achado na pesquisa — não uma média da categoria. Para uma
   marca nova, é o preço a bater.

   A pesquisa (comparáveis nacionais, volume da caixa quando não foi
   anotado, NCM provável e artigos de regulação) vem do servidor, por
   viagem. Esta conta não depende de rede.
   ============================================================ */
const ANALISE = (() => {
  // capacidade útil e peso máximo de cada contêiner
  const CT = { c20: { cap: 28, kg: 21000, nome: "20'" }, c40: { cap: 60, kg: 26000, nome: "40'" } };
  const LCL_MAX = 15;                       // m³: acima disso o contêiner compensa
  const FAIXAS = [
    { id: 'otimo', nome: 'Ótimo', min: 2.5 },
    { id: 'bom', nome: 'Bom', min: 1.8 },
    { id: 'apertado', nome: 'Apertado', min: 1.3 },
    { id: 'nao', nome: 'Não fecha', min: 0 }
  ];
  const faixa = (m) => FAIXAS.find(f => m >= f.min) || FAIXAS[FAIXAS.length - 1];
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const plural = (n, s, p) => n === 1 ? s : p;

  const tarifas = (cfg) => ({
    lcl: num(cfg.anaLcl) || 95,
    c20: num(cfg.ana20) || 4000,
    c40: num(cfg.ana40) || 6000
  });

  /* o mais barato que comporta o volume (m³) e o peso (kg) */
  function frete(V, W, t) {
    const op = [];
    if (V <= LCL_MAX && W <= 15000) op.push({ usd: Math.max(1, V, W / 1000) * t.lcl, modo: 'carga fracionada' });
    const n40 = Math.max(Math.ceil(V / CT.c40.cap), Math.ceil(W / CT.c40.kg), 1);
    op.push({ usd: n40 * t.c40, modo: n40 + ' ' + plural(n40, 'contêiner', 'contêineres') + " de 40'" });
    const n20 = Math.max(Math.ceil(V / CT.c20.cap), Math.ceil(W / CT.c20.kg), 1);
    op.push({ usd: n20 * t.c20, modo: n20 + ' ' + plural(n20, 'contêiner', 'contêineres') + " de 20'" });
    const k = Math.floor(V / CT.c40.cap);
    if (k >= 1 && V > k * CT.c40.cap) {
      const rV = V - k * CT.c40.cap, rW = W * rV / V;
      if (rV <= CT.c20.cap && rW <= CT.c20.kg) op.push({ usd: k * t.c40 + t.c20, modo: k + " de 40' + 1 de 20'" });
      if (rV <= LCL_MAX) op.push({ usd: k * t.c40 + Math.max(1, rV, rW / 1000) * t.lcl, modo: k + " de 40' + carga fracionada" });
    }
    return op.reduce((m, o) => o.usd < m.usd ? o : m);
  }

  /* "negociação para 500 peças", "mínimo de 300": quando o MOQ não foi cadastrado */
  function pista(txt) {
    const m = /(?:negocia\w*\s+para|m[ií]nimo de|moq\s*(?:de)?)\s*(\d[\d.]*)/i.exec(txt || '')
      || /(\d[\d.]*)\s*(?:pe[çc]as|pcs|unidades)/i.exec(txt || '');
    return m ? parseInt(m[1].replace(/\./g, ''), 10) || 0 : 0;
  }

  /* volume e peso da caixa: o anotado no app vale; o 0,002 m³ e 0,4 kg que a
     calculadora rápida grava sozinha, não. Peso absurdo (1.000 kg numa escova, 1,2 kg
     numa bicicleta) também não: longe demais da estimativa da pesquisa, vale a estimativa. */
  const padrao = (p) => num(p.cbm) === 0.002 && num(p.peso) === 0.4;
  function volume(p, a) {
    const est = (a && a.vol) || { cbm: 0, kg: 0, fonte: '' };
    const padrao_ = padrao(p);
    const cbm = !padrao_ && num(p.cbm) > 0.002 ? num(p.cbm) : num(est.cbm);
    const pesoOk = !padrao_ && num(p.peso) > 0 && (!est.kg || (num(p.peso) <= 5 * num(est.kg) && num(p.peso) >= num(est.kg) / 5));
    const kg = pesoOk ? num(p.peso) : num(est.kg);
    const fonte = cbm === num(p.cbm) && cbm > 0.002 ? 'volume anotado no app' : (est.fonte || '');
    return { cbm, kg, fonte, estimado: !(cbm === num(p.cbm) && cbm > 0.002) };
  }

  /* o pedido mínimo: MOQ cadastrado, contêiner inteiro, ou o que a descrição diz.
     a.pedido, da pesquisa, corrige o que não dá para ler do cadastro
     (ex.: "mínimo de US$ 15.000" anotado como MOQ 15.000). */
  function pedido(p, vol, a) {
    const moq = num(p.moq);
    // a calculadora rápida grava 1 em "Vou pedir" junto com o volume-padrão: não é pedido
    const qtd = padrao(p) && num(p.qtd) <= 1 ? 0 : num(p.qtd);
    const c = CT[p.moqUn];
    let q, como = '', fcl = null, aviso = '';
    if (a && a.pedido && num(a.pedido.q) > 0) {
      q = num(a.pedido.q); como = 'ana';
    } else if (c) {
      let n = Math.max(1, Math.round(moq) || 1);
      if (n > 3) { aviso = 'O MOQ anotado é de ' + n + ' contêineres; a conta usa 1.'; n = 1; }
      const cabe = vol.cbm > 0 ? Math.max(1, Math.min(Math.floor(c.cap / vol.cbm), vol.kg > 0 ? Math.floor(c.kg / vol.kg) : Infinity)) : 0;
      q = cabe * n;
      fcl = { n, tipo: p.moqUn };
      como = 'cont';
    } else if (moq > 0) {
      q = moq; como = 'moq';
    } else if (pista(p.obs)) {
      q = pista(p.obs); como = 'pista';
    } else if (qtd > 0) {
      q = qtd; como = 'qtd';
    } else {
      q = vol.cbm > 0 ? Math.max(1, Math.floor(1 / vol.cbm)) : 1; como = 'm3';
    }
    // o que vocês anotaram em "Vou pedir", quando passa do mínimo, é o pedido
    if (qtd > q) { q = qtd; como = 'vou_pedir'; fcl = null; }
    return { q, como, fcl, aviso };
  }

  function custo(prod, q, freteUsd, cfg, junto) {
    const c = Object.assign({}, cfg, { freteModo: 'fechado', freteUsd },
      junto ? { despesasBrl: 0, siscomexBrl: 0 } : {});
    return CUSTOS.calcular(Object.assign({}, prod, { qtd: q, moq: 0 }), c);
  }

  /* p = produto do app; a = linha da análise (pesquisa); cfg = Config deste celular */
  function calcular(p, a, cfg) {
    if (!a || !a.ref || !(num(a.ref.valor) > 0) || !(num(p.preco) > 0)) return null;
    const vol = volume(p, a);
    if (!(vol.cbm > 0)) return null;
    const t = tarifas(cfg);
    const ped = pedido(p, vol, a);
    const q = ped.q;
    const V = q * vol.cbm, W = q * vol.kg;
    let fr;
    if (a.frete_forn > 0) fr = { usd: num(a.frete_forn), modo: 'frete informado pelo fornecedor' };
    else if (ped.fcl) fr = { usd: ped.fcl.n * t[ped.fcl.tipo], modo: ped.fcl.n + ' ' + plural(ped.fcl.n, 'contêiner', 'contêineres') + ' de ' + CT[ped.fcl.tipo].nome };
    else fr = frete(V, W, t);

    const ncm = String(p.ncm || a.ncm || '').replace(/\D/g, '');
    const it = ncm && typeof BASE !== 'undefined' ? BASE.item(ncm) : null;
    const ii = typeof p.ii === 'number' && p.ncm ? p.ii : (it ? it.ii : 0);
    const ipi = p.ncm && (typeof p.ipi === 'number' || p.ipi === 'NT') ? p.ipi : (it ? it.ipi : 0);
    const prod = { nome: p.nome, preco: num(p.preco), moeda: p.moeda || 'USD', un: p.un || 'pc', moqUn: p.un || 'pc',
      cbm: vol.cbm, peso: vol.kg, ncm, ii, ipi, cond: p.cond || 'novo' };

    const c = custo(prod, q, fr.usd, cfg, false);
    const cj = custo(prod, q, fr.usd, cfg, true);
    const ref = num(a.ref.valor);
    const m = ref / c.unit, mj = ref / cj.unit;
    return {
      q, como: ped.como, aviso: ped.aviso, vol, V, W,
      freteUsd: fr.usd, freteModo: fr.modo, freteUn: fr.usd / q,
      pedidoUsd: q * num(p.preco) * (p.moeda === 'CNY' ? num(cfg.cnyBrl) / num(cfg.usdBrl) : 1),
      ncm, ncmDoApp: !!p.ncm, ii, ipi,
      custo: c.unit, custoJunto: cj.unit, fixasUn: c.unit - cj.unit,
      ref, multiplo: m, multiploJunto: mj, faixa: faixa(m), faixaJunto: faixa(mj),
      prod, fr
    };
  }

  /* Que FOB deixaria o produto na faixa pedida (padrão: Bom)? null se nem de graça. */
  function fobPara(p, a, cfg, alvo) {
    const r = calcular(p, a, cfg);
    if (!r) return null;
    const minimo = alvo || 1.8;
    if (r.multiplo >= minimo) return { ja: true, fob: num(p.preco) };
    const custoMax = r.ref / minimo;
    const de = (preco) => custo(Object.assign({}, r.prod, { preco }), r.q, r.freteUsd, cfg, false).unit;
    if (de(0) > custoMax) return { ja: false, fob: null };
    let lo = 0, hi = num(p.preco);
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (de(mid) <= custoMax) lo = mid; else hi = mid; }
    return { ja: false, fob: lo, queda: 1 - lo / num(p.preco) };
  }

  return { calcular, fobPara, frete, pedido, volume, pista, FAIXAS, faixa, CT, LCL_MAX };
})();
