/* ============================================================
   custos.js — previsão de custo landed de importação (Brasil).
   Cada linha traz a base de cálculo usada, para dar pra auditar.
   ============================================================ */
const CUSTOS = (() => {

  /* alíquotas gerais de PIS/COFINS-Importação (Lei 10.865/2004) */
  const PIS_IMP = 2.10;
  const COFINS_IMP = 9.65;
  /* 2026 é ano-teste da reforma: CBS 0,9% + IBS 0,1% (EC 132 / LC 214) */
  const CBS_2026 = 0.90;
  const IBS_2026 = 0.10;
  /* AFRMM sobre o frete marítimo (Lei 14.301/2022 reduziu de 25% p/ 8%) */
  const AFRMM = 8.00;

  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

  function calcular(p, cfg) {
    const L = [];                                  // linhas do extrato
    const add = (grupo, rotulo, valor, ref) => { L.push({ grupo, rotulo, valor, ref }); return valor; };

    const qtd = Math.max(1, num(p.qtd) || num(p.moq) || 1);
    const cambio = p.moeda === 'CNY' ? num(cfg.cnyBrl) : num(cfg.usdBrl);
    const usdBrl = num(cfg.usdBrl);

    /* ---------- 1. mercadoria ---------- */
    const fobUnit = num(p.preco);
    const fob = fobUnit * qtd * cambio;
    add('merc', 'Mercadoria FOB', fob,
      `${qtd.toLocaleString('pt-BR')} un × ${p.moeda} ${fobUnit.toFixed(2)} × ${cambio.toFixed(4)}`);

    /* ---------- 2. frete internacional ---------- */
    const aereo = cfg.modal === 'aereo';
    let freteUsd = 0, refFrete = '';
    if (cfg.freteModo === 'tarifa') {
      if (aereo) {
        // aéreo cobra pelo peso taxável: maior entre peso real e volumétrico (1 m³ ≈ 167 kg)
        const pesoReal = num(p.peso) * qtd;
        const pesoVol = num(p.cbm) * qtd * 167;
        const taxavel = Math.max(pesoReal, pesoVol);
        freteUsd = taxavel * num(cfg.tarifaFrete);
        refFrete = `${taxavel.toFixed(1)} kg taxáveis × USD ${num(cfg.tarifaFrete).toFixed(2)}/kg`;
      } else {
        // marítimo LCL cobra por m³ (ou tonelada, o que for maior — "W/M")
        const m3 = num(p.cbm) * qtd;
        const ton = num(p.peso) * qtd / 1000;
        const wm = Math.max(m3, ton);
        freteUsd = wm * num(cfg.tarifaFrete);
        refFrete = `${wm.toFixed(3)} W/M × USD ${num(cfg.tarifaFrete).toFixed(2)}`;
      }
    } else {
      freteUsd = num(cfg.freteUsd);
      refFrete = `USD ${freteUsd.toFixed(2)} (valor fechado)`;
    }
    const frete = freteUsd * usdBrl;
    add('merc', 'Frete internacional', frete, refFrete);

    /* ---------- 3. seguro ---------- */
    const seguro = (fob + frete) * num(cfg.seguroPct) / 100;
    add('merc', 'Seguro internacional', seguro, `${num(cfg.seguroPct)}% de (FOB + frete)`);

    /* ---------- 4. valor aduaneiro ---------- */
    const capatazia = cfg.capatazia ? num(cfg.capataziaBrl) : 0;
    if (cfg.capatazia) add('merc', 'Capatazia / THC no valor aduaneiro', capatazia, 'incluída por opção');
    const VA = fob + frete + seguro + capatazia;
    add('va', 'Valor aduaneiro (VA)', VA, 'FOB + frete + seguro' + (cfg.capatazia ? ' + capatazia' : ''));

    /* ---------- 5. tributos ---------- */
    const iiPct = (typeof p.ii === 'number') ? p.ii : 0;
    const II = VA * iiPct / 100;
    add('trib', `Imposto de Importação (${iiPct}%)`, II, 'VA × alíquota TEC');

    const ipiPct = (typeof p.ipi === 'number') ? p.ipi : 0;
    const ipiNT = (p.ipi === 'NT');
    const IPI = ipiNT ? 0 : (VA + II) * ipiPct / 100;
    add('trib', ipiNT ? 'IPI (NT — não tributado)' : `IPI (${ipiPct}%)`, IPI, '(VA + II) × alíquota TIPI');

    const legado = cfg.dataRef !== '2027';
    const PIS = legado ? VA * PIS_IMP / 100 : 0;
    const COFINS = legado ? VA * COFINS_IMP / 100 : 0;
    if (legado) {
      add('trib', `PIS-Importação (${PIS_IMP}%)`, PIS, 'VA × alíquota');
      add('trib', `COFINS-Importação (${COFINS_IMP}%)`, COFINS, 'VA × alíquota');
    }

    /* CBS/IBS — base ainda em regulamentação; usa VA + II + IPI */
    let CBS = 0, IBS = 0, cbsCompensa = false;
    const baseCbs = VA + II + IPI;
    if (cfg.dataRef === '2026') {
      CBS = baseCbs * CBS_2026 / 100;
      IBS = baseCbs * IBS_2026 / 100;
      cbsCompensa = !!cfg.compensarCbs;
      add('trib', `CBS-Importação (${CBS_2026}% — ano-teste)`, CBS, 'base aprox. VA + II + IPI');
      add('trib', `IBS-Importação (${IBS_2026}% — ano-teste)`, IBS, 'base aprox. VA + II + IPI');
    } else if (cfg.dataRef === '2027') {
      CBS = baseCbs * num(cfg.cbsPct) / 100;
      IBS = baseCbs * IBS_2026 / 100;
      add('trib', `CBS-Importação (${num(cfg.cbsPct)}% — estimada)`, CBS, 'base aprox. VA + II + IPI');
      add('trib', `IBS-Importação (${IBS_2026}%)`, IBS, 'base aprox. VA + II + IPI');
    }

    /* ---------- 6. encargos ---------- */
    const afrmm = aereo ? 0 : frete * AFRMM / 100;
    if (!aereo) add('enc', `AFRMM (${AFRMM}% do frete marítimo)`, afrmm, 'frete × 8%');
    const siscomex = num(cfg.siscomexBrl);
    add('enc', 'Taxa Siscomex / DUIMP', siscomex, 'valor fixo configurado');
    const despesas = num(cfg.despesasBrl);
    add('enc', 'Despesas locais', despesas, 'THC, armazenagem, despachante, frete interno');

    /* ---------- 7. ICMS (cálculo "por dentro") ---------- */
    const icmsPct = num(cfg.icmsPct);
    const baseIcmsSemGrossUp = VA + II + IPI + PIS + COFINS + afrmm + siscomex + despesas;
    const a = icmsPct / 100;
    const baseIcms = a < 1 ? baseIcmsSemGrossUp / (1 - a) : 0;
    const ICMS = baseIcms * a;
    add('trib', `ICMS-Importação (${icmsPct}%)`, ICMS,
      `base R$ ${baseIcms.toFixed(2)} (incl. o próprio ICMS)`);

    /* ---------- 8. totais ---------- */
    const tributos = II + IPI + PIS + COFINS + CBS + IBS + ICMS;
    const total = VA + tributos + afrmm + siscomex + despesas;

    /* ---------- 9. créditos recuperáveis ---------- */
    const aproveita = cfg.regime === 'real';
    let cred = 0;
    const credL = [];
    if (aproveita) {
      if (cfg.creditaIpi && !ipiNT) { cred += IPI; credL.push({ rotulo: 'Crédito de IPI', valor: IPI }); }
      cred += PIS; if (PIS) credL.push({ rotulo: 'Crédito de PIS', valor: PIS });
      cred += COFINS; if (COFINS) credL.push({ rotulo: 'Crédito de COFINS', valor: COFINS });
      cred += ICMS; if (ICMS) credL.push({ rotulo: 'Crédito de ICMS', valor: ICMS });
      if (cbsCompensa) {
        cred += CBS + IBS;
        credL.push({ rotulo: 'CBS/IBS 2026 compensados', valor: CBS + IBS });
      }
    }
    const liquido = total - cred;

    return {
      qtd, cambio, fobUnit,
      linhas: L,
      VA, II, IPI, PIS, COFINS, CBS, IBS, ICMS, afrmm, siscomex, despesas,
      tributos, total, creditos: cred, creditoLinhas: credL, liquido,
      unit: total / qtd,
      unitLiquido: liquido / qtd,
      /* múltiplo sobre o FOB: quantas vezes o preço de fábrica */
      multiplo: fob > 0 ? total / fob : 0,
      multiploLiquido: fob > 0 ? liquido / fob : 0,
      cargaPct: VA > 0 ? tributos / VA * 100 : 0,
      aproveita, fob, frete, seguro
    };
  }

  /* preço de venda necessário para uma margem sobre o preço de venda */
  function precoVenda(custoUnit, margemPct) {
    const m = num(margemPct) / 100;
    return m < 1 ? custoUnit / (1 - m) : 0;
  }

  const CFG_PADRAO = {
    usdBrl: 5.40, cnyBrl: 0.76,
    uf: 'SC', icmsPct: 17, regime: 'real', creditaIpi: true,
    dataRef: '2026', compensarCbs: true, cbsPct: 8.80,
    capatazia: false, capataziaBrl: 0,
    modal: 'lcl', freteModo: 'tarifa', tarifaFrete: 95, freteUsd: 0,
    seguroPct: 0.35, despesasBrl: 3500, siscomexBrl: 154.23,
    margemAlvo: 45
  };

  return { calcular, precoVenda, CFG_PADRAO, PIS_IMP, COFINS_IMP, AFRMM };
})();
