/* ============================================================
   ui.js — telas e amarração. Nada aqui depende de rede.
   ============================================================ */
(() => {
  const VERSAO = 'v6 · 14/10/2026 · foto calibrada';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const brl = (v) => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const n2 = (v) => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let cfg = Object.assign({}, CUSTOS.CFG_PADRAO);
  let produtos = [];
  let pendentes = [];          // mídias da captura ainda não salva
  let condAtual = 'novo';
  let ordem = 'data';
  const urlCache = new Map();

  /* ---------------- utilitários de tela ---------------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
  }
  function modal(html) {
    $('#modal-body').innerHTML = html;
    $('#modal').classList.add('on');
  }
  function fecharModal() { $('#modal').classList.remove('on'); $('#modal-body').innerHTML = ''; }

  const TITULOS = { capturar: 'Capturar', produtos: 'Produtos', ncm: 'Classificação NCM', custos: 'Previsão de custos', config: 'Configuração' };
  function ir(v) {
    $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    $('#view-title').textContent = TITULOS[v] || v;
    window.scrollTo(0, 0);
    if (v === 'produtos') renderProdutos();
    if (v === 'custos') renderSelectCustos();
    if (v === 'ncm' && !$('#m-guiado').hidden) renderGuia();
  }

  const NIVEL_TAG = { ok: 'tag-ok', warn: 'tag-warn', mid: 'tag-mid', bad: 'tag-bad' };

  /* ---------------- compressão de imagem ----------------
     Foto de celular tem 3-5 MB. Sem reduzir, 50 produtos enchem
     o armazenamento do navegador e o backup fica impossível.     */
  function comprimir(file) {
    if (!file.type.startsWith('image/')) return Promise.resolve(file);
    const LADO = 1280, Q = 0.72;

    // Decodificar com a orientação EXIF aplicada. Sem isso a foto de celular
    // é gravada deitada, e o reconhecimento erra um objeto óbvio.
    const decodificar = self.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(() => createImageBitmap(file)).catch(() => null)
      : Promise.resolve(null);

    return decodificar.then(bmp => new Promise((ok) => {
      const desenhar = (fonte, lw, lh) => {
        const r = Math.min(1, LADO / Math.max(lw, lh));
        const w = Math.round(lw * r), h = Math.round(lh * r);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(fonte, 0, 0, w, h);
        c.toBlob(b => ok(b && b.size < file.size ? b : file), 'image/jpeg', Q);
      };
      if (bmp) { desenhar(bmp, bmp.width, bmp.height); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); desenhar(img, img.width, img.height); };
      img.onerror = () => { URL.revokeObjectURL(url); ok(file); };
      img.src = url;
    }));
  }

  function blobUrl(id, blob) {
    if (!urlCache.has(id)) urlCache.set(id, URL.createObjectURL(blob));
    return urlCache.get(id);
  }

  /* ---------------- captura ---------------- */
  function receberArquivos(files) {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    Promise.all(lista.map(f => comprimir(f).then(b => ({
      id: DB.novoId(), blob: b, tipo: f.type, nome: f.name
    })))).then(novos => {
      pendentes = pendentes.concat(novos);
      renderThumbs();
      toast(novos.length + (novos.length > 1 ? ' arquivos adicionados' : ' arquivo adicionado'));
      const foto = novos.find(m => (m.tipo || '').startsWith('image'));
      if (foto) reconhecer(foto.blob);
    });
  }

  /* ---------------- reconhecimento pela foto ----------------
     Roda no próprio aparelho. Sugere, nunca decide: o material
     continua sendo pergunta, porque é ele que define a NCM.     */
  function reconhecer(blob) {
    const el = $('#sugestao');
    el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">
      analisando a foto no aparelho…</p></div>`;
    VISAO.carregar(m => {
      el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">${esc(m)}</p></div>`;
    })
      .then(() => VISAO.classificar(blob, 3))
      .then(({ sugestoes, fracas, bruto, diag }) => {
        // o diagnóstico fica sempre disponível: sem ele é impossível saber
        // POR QUE uma foto óbvia não foi reconhecida
        const detalhe = `<details style="margin-top:10px">
          <summary class="hint" style="cursor:pointer">O que o modelo viu (para mandar ao Leonardo)</summary>
          <table class="br" style="margin-top:8px">
            ${bruto.map(b => `<tr><td>${esc(b.rot)}</td><td>${(b.p * 100).toFixed(1)}%</td></tr>`).join('')}
            <tr class="sub"><td>imagem</td><td>${esc(diag.imagem)}</td></tr>
            <tr class="sub"><td>melhor enquadramento</td><td>${esc(diag.vista)}</td></tr>
            <tr class="sub"><td>processamento</td><td>${diag.ms} ms · ${esc(diag.backend)}</td></tr>
          </table></details>`;

        const lista = (arr, cls) => `<div class="opcoes">` + arr.map((s, i) => `
            <button data-sug="${i}" data-cls="${cls}"><span>${esc(s.produto)}
              <small>${Math.round(s.p * 100)}% de confiança · ${esc(s.rots.slice(0, 2).join(', '))}</small></span>
              <span class="seta">›</span></button>`).join('') + `</div>`;

        if (sugestoes.length) {
          el.innerHTML = `<div class="card">
            <h3 style="margin-bottom:9px">A foto parece ser</h3>
            ${lista(sugestoes, 'forte')}
            <p class="hint">Toque no certo para já sair a NCM, o imposto e o alerta.
            Se nenhum estiver certo, ignore — o modelo reconhece o objeto, não o material.</p>
            ${detalhe}</div>`;
        } else {
          /* Palpite fraco NÃO vira botão. Medido: dos palpites abaixo do
             limiar, só 1 em 8 estava certo — como botão, ele seria quase
             sempre um toque errado, e ainda ancoraria a pessoa numa resposta
             ruim. Vira texto informativo, e o caminho é o modo Guiado.      */
          const palpite = (fracas[0] || null);
          el.innerHTML = `<div class="card">
            <h3 style="margin-bottom:4px">Não reconheci</h3>
            <p class="hint" style="margin:0">${palpite
              ? 'Talvez seja <b>' + esc(palpite.produto) + '</b>, mas a certeza é baixa demais para eu afirmar. '
              : (bruto.length ? 'O que mais pareceu foi <b>' + esc(bruto[0].rot) + '</b>, que não está no dicionário. ' : '')
            }Use a aba <b>NCM</b> no modo Guiado — são três toques.</p>
            ${detalhe}</div>`;
        }

        const alvos = sugestoes;
        el.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => {
          const s = alvos[+b.dataset.sug];
          if (!s) return;
          if (!$('#f-nome').value.trim()) $('#f-nome').value = s.produto.split(' / ')[0];
          gIrParaProduto(s.produto);
        });
      })
      .catch(e => {
        el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">
          Reconhecimento por foto indisponível (${esc(e.message)}).
          Use a aba <b>NCM</b> no modo Guiado.</p></div>`;
      });
  }

  function renderThumbs() {
    const el = $('#thumbs');
    if (!pendentes.length) { el.innerHTML = ''; return; }
    el.innerHTML = pendentes.map(m => {
      const u = blobUrl(m.id, m.blob);
      const video = (m.tipo || '').startsWith('video');
      return `<div class="thumb">
        ${video ? `<video src="${u}" muted playsinline></video><span class="vid">▶ vídeo</span>`
                : `<img src="${u}" alt="">`}
        <b data-rm="${m.id}">×</b></div>`;
    }).join('');
    el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      pendentes = pendentes.filter(x => x.id !== b.dataset.rm);
      renderThumbs();
    });
  }

  function limparForm() {
    ['f-nome', 'f-desc', 'f-preco', 'f-moq', 'f-qtd', 'f-peso', 'f-cbm', 'f-obs'].forEach(id => $('#' + id).value = '');
    pendentes = []; renderThumbs();
    document.querySelector('#sugestao').innerHTML = '';
    // fornecedor/estande/contato ficam: normalmente são vários produtos do mesmo estande
  }

  function salvarProduto() {
    const nome = $('#f-nome').value.trim();
    if (!nome) { toast('Dê um nome ao produto'); $('#f-nome').focus(); return; }
    const id = DB.novoId();
    const p = {
      id, nome,
      desc: $('#f-desc').value.trim(),
      preco: parseFloat($('#f-preco').value) || 0,
      moeda: $('#f-moeda').value,
      moq: parseInt($('#f-moq').value) || 0,
      qtd: parseInt($('#f-qtd').value) || 0,
      peso: parseFloat($('#f-peso').value) || 0,
      cbm: parseFloat($('#f-cbm').value) || 0,
      forn: $('#f-forn').value.trim(),
      estande: $('#f-estande').value.trim(),
      fase: $('#f-fase').value,
      contato: $('#f-contato').value.trim(),
      cond: condAtual,
      obs: $('#f-obs').value.trim(),
      ncm: null, ncmDesc: '', ii: null, ipi: null,
      criado: Date.now(), atualizado: Date.now()
    };
    const midias = pendentes.map(m => ({ id: m.id, produtoId: id, blob: m.blob, tipo: m.tipo, nome: m.nome }));
    DB.salvarProduto(p)
      .then(() => Promise.all(midias.map(m => DB.salvarMidia(m))))
      .then(() => { produtos.push(p); limparForm(); atualizaContador(); toast('Produto salvo · agora classifique na aba NCM'); })
      .catch(e => toast('Erro ao salvar: ' + e.message));
  }

  function atualizaContador() {
    $('#count-pill').textContent = produtos.length + (produtos.length === 1 ? ' produto' : ' produtos');
  }

  /* ---------------- lista de produtos ---------------- */
  function renderProdutos() {
    const q = BASE.norm($('#p-filtro').value);
    let lista = produtos.slice();
    if (q) {
      lista = lista.filter(p => BASE.norm([p.nome, p.desc, p.forn, p.estande, p.ncm, p.obs].join(' ')).includes(q));
    }
    const riscoDe = (p) => p.ncm ? ({ ok: 0, warn: 1, mid: 2, bad: 3 })[BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }).nivel] : -1;
    if (ordem === 'data') lista.sort((a, b) => b.criado - a.criado);
    if (ordem === 'risco') lista.sort((a, b) => riscoDe(b) - riscoDe(a) || b.criado - a.criado);
    if (ordem === 'custo') lista.sort((a, b) => (custoUnitDe(a) || 9e9) - (custoUnitDe(b) || 9e9));

    const el = $('#p-lista');
    if (!lista.length) {
      el.innerHTML = `<div class="empty">${produtos.length ? 'Nada encontrado com esse filtro.'
        : 'Nenhum produto ainda.<br>Vá em <b>Capturar</b> e fotografe o primeiro.'}</div>`;
      return;
    }
    el.innerHTML = lista.map(p => cardProduto(p)).join('');
    // carrega as fotos de forma assíncrona
    lista.forEach(p => DB.midiasDe(p.id).then(ms => {
      const img = el.querySelector(`[data-pic="${p.id}"]`);
      const foto = ms.find(m => (m.tipo || '').startsWith('image'));
      if (img && foto) img.src = blobUrl(foto.id, foto.blob);
    }));
    el.querySelectorAll('[data-abrir]').forEach(c => c.onclick = () => abrirProduto(c.dataset.abrir));
  }

  function custoUnitDe(p) {
    if (!p.ncm || typeof p.ii !== 'number') return null;
    return CUSTOS.calcular(p, cfg).unit;
  }

  function cardProduto(p) {
    const r = p.ncm ? BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }) : null;
    const cu = custoUnitDe(p);
    const tags = [];
    if (p.ncm) {
      tags.push(`<span class="tag tag-ac code">${p.ncm}</span>`);
      tags.push(`<span class="tag ${NIVEL_TAG[r.nivel]}">${esc(r.rotulo)}</span>`);
      r.orgaos.slice(0, 3).forEach(o => tags.push(`<span class="tag">${esc(o)}</span>`));
    } else if (p.paraRevisar) {
      tags.push('<span class="tag tag-bad">↑ Leonardo precisa classificar</span>');
    } else {
      tags.push('<span class="tag tag-warn">sem NCM — classificar</span>');
    }
    if (p.cond === 'usado') tags.push('<span class="tag tag-bad">usado</span>');
    const sub = [p.forn, p.estande && 'estande ' + p.estande,
      p.preco ? `${p.moeda} ${n2(p.preco)}` : '', p.moq ? `MOQ ${p.moq}` : '']
      .filter(Boolean).join(' · ');
    return `<div class="it" data-abrir="${p.id}">
      <div class="it-top">
        <img class="it-pic" data-pic="${p.id}" alt="">
        <div class="it-b">
          <div class="it-nome">${esc(p.nome)}</div>
          <div class="it-sub">${esc(sub) || '—'}</div>
        </div>
        ${cu ? `<div class="sc"><b>${brl(cu)}</b><span>/un</span></div>` : ''}
      </div>
      <div class="it-foot">${tags.join('')}</div>
    </div>`;
  }

  /* ---------------- detalhe do produto ---------------- */
  function abrirProduto(id) {
    const p = produtos.find(x => x.id === id);
    if (!p) return;
    DB.midiasDe(id).then(ms => {
      const fotos = ms.map(m => {
        const u = blobUrl(m.id, m.blob);
        return (m.tipo || '').startsWith('video')
          ? `<div class="thumb"><video src="${u}" controls playsinline></video></div>`
          : `<div class="thumb"><img src="${u}" alt=""></div>`;
      }).join('');
      const r = p.ncm ? BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }) : null;
      modal(`
        <h1 style="font-size:18px;margin-bottom:4px">${esc(p.nome)}</h1>
        <p class="hint" style="margin:0 0 12px">${esc([p.forn, p.estande && 'estande ' + p.estande, 'Fase ' + p.fase].filter(Boolean).join(' · '))}</p>
        ${fotos ? `<div class="thumbs">${fotos}</div>` : ''}
        ${p.desc ? `<p style="font-size:13.5px;color:var(--dim)">${esc(p.desc)}</p>` : ''}
        <table class="br" style="margin:10px 0">
          ${linhaInfo('Preço FOB', p.preco ? `${p.moeda} ${n2(p.preco)}` : '—')}
          ${linhaInfo('MOQ / quantidade', `${p.moq || '—'} / ${p.qtd || '—'}`)}
          ${linhaInfo('Peso / CBM unit.', `${p.peso || '—'} kg / ${p.cbm || '—'} m³`)}
          ${linhaInfo('Contato', p.contato || '—')}
          ${linhaInfo('Condição', p.cond === 'usado' ? 'usado / recondicionado' : 'novo')}
          ${p.obs ? linhaInfo('Observações', p.obs) : ''}
        </table>
        ${r ? blocoRisco(r) : '<p class="warn">Sem NCM atribuída. Classifique para ver barreiras e custo.</p>'}
        <div style="margin-top:14px">
          <button class="ghost" id="m-classificar">${p.ncm ? 'Trocar a NCM' : 'Classificar NCM'}</button>
          ${p.ncm ? '<button class="ghost" id="m-custo">Ver previsão de custo</button>' : ''}
          <button class="ghost danger" id="m-apagar">Apagar produto</button>
        </div>`);
      $('#m-classificar').onclick = () => {
        fecharModal();
        alvoProduto = p.id;
        // vai para o assistente guiado: é o caminho de quem não sabe comex
        $$('#ncm-modo button').forEach(x => x.classList.toggle('on', x.dataset.v === 'guiado'));
        $('#m-guiado').hidden = false;
        $('#m-busca').hidden = true;
        $('#q').value = (p.nome + ' ' + p.desc).trim();
        buscarNcm();
        gReset();
        ir('ncm');
      };
      const bc = $('#m-custo');
      if (bc) bc.onclick = () => { fecharModal(); ir('custos'); $('#c-produto').value = p.id; renderCustos(); };
      $('#m-apagar').onclick = () => {
        if (!confirm('Apagar "' + p.nome + '" e suas fotos?')) return;
        DB.apagarProduto(p.id).then(() => {
          produtos = produtos.filter(x => x.id !== p.id);
          fecharModal(); atualizaContador(); renderProdutos(); toast('Produto apagado');
        });
      };
    });
  }
  const linhaInfo = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;

  /* ---------------- bloco de risco ---------------- */
  function blocoRisco(r) {
    const it = r.item;
    const pcB = CUSTOS.pisCofinsDe(r.ncm);
    let h = `<div class="card" style="margin:12px 0 0">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px">
        <span class="code" style="font-size:16px;font-weight:700">${r.ncm}</span>
        <span class="tag ${NIVEL_TAG[r.nivel]}">${esc(r.rotulo)}</span>
      </div>`;
    if (it) {
      h += `<div style="font-size:13.5px;margin-bottom:4px">${esc(it.desc)}</div>
            <div class="it-sub" style="margin-bottom:9px">${esc(BASE.capitulo(it.cap))}${it.path ? ' › ' + esc(it.path) : ''}</div>
            <table class="br">
              <tr><td>Imposto de Importação<span class="ref">${esc(it.iiFonte)}</span></td><td>${it.ii === null ? '—' : it.ii + '%'}</td></tr>
              <tr><td>IPI<span class="ref">base: VA + II</span></td><td>${it.ipi === null ? '—' : (it.ipi === 'NT' ? 'NT' : it.ipi + '%')}</td></tr>
              <tr><td>PIS-Importação<span class="ref">${esc(pcB.regime)}</span></td><td>${pcB.pis}%</td></tr>
              <tr><td>COFINS-Importação<span class="ref">${esc(pcB.regime)}</span></td><td>${pcB.cofins}%</td></tr>
              ${it.mark ? `<tr><td>Marcador TEC</td><td>${esc(it.mark)}</td></tr>` : ''}
            </table>
            <p class="hint">PIS/COFINS conforme Lei 10.865/2004, art. 8º. Não está modelado aqui o
            adicional de 1 ponto percentual de COFINS que incide sobre as NCMs do Anexo I da Lei
            12.546/2011 — confirme com seu despachante se a sua posição está nessa lista.</p>`;
    }

    if (r.antidumping.length) {
      h += `<h3 style="margin:14px 0 7px">Antidumping</h3>`;
      r.antidumping.forEach(m => {
        h += `<div class="it" style="cursor:default;margin-bottom:7px">
          <div class="it-nome" style="font-size:14px">${esc(m.prod)}</div>
          <div class="it-sub">${esc(m.medida)}<br>Origem: ${esc(m.origem)}<br>Vigência: ${esc(m.prazo)}</div>
          <div class="it-foot"><span class="tag ${m.susp ? 'tag-warn' : 'tag-bad'}">${m.susp ? 'cobrança suspensa' : 'em cobrança'}</span>
          ${m.rev ? '<span class="tag tag-warn">prazo em revisão</span>' : ''}
          <span class="tag ${m.via === 'ncm' ? 'tag-bad' : ''}">${m.via === 'ncm' ? 'bate pela NCM' : 'parecido pelo nome'}</span></div></div>`;
      });
      h += `<p class="warn">A tabela oficial do DECOM não traz NCM: "bate pela NCM" usa um mapa de triagem feito à mão,
        "parecido pelo nome" é só semelhança de texto. Nos dois casos confirme o escopo exato na Resolução Gecex da medida
        antes de fechar pedido — direito antidumping entra por fora do cálculo e pode passar de 100% do valor.</p>`;
    }

    if (r.ta.length) {
      h += `<h3 style="margin:14px 0 7px">Tratamento administrativo</h3><table class="br">`;
      r.ta.slice(0, 10).forEach(t => {
        const tg = t.nivel >= 4 ? 'tag-bad' : t.nivel === 3 ? 'tag-mid' : 'tag-warn';
        h += `<tr><td><b>${esc(t.orgao)}</b> <span class="tag ${tg}">${esc(t.regime || '—')}</span>
          <span class="ref">${esc(BASE.orgaoNome(t.orgao))}</span>
          <span class="ref">aplica-se a ${t.prefixo} · ${esc(t.trat)}${t.ex ? ' · destaque ' + esc(t.ex) : ''}</span>
          ${t.excecao ? `<span class="ref">exceções: ${esc(t.excecao)}</span>` : ''}</td>
          <td>${t.condicional ? 'condicional' : ''}</td></tr>`;
      });
      h += `</table>`;
      if (r.ta.some(t => t.condicional))
        h += `<p class="hint">"Condicional" = a regra depende do destaque/EX declarado ou do país de origem. Confirme no simulador do Portal Único.</p>`;
    }

    if (r.lpco.length) {
      h += `<h3 style="margin:14px 0 7px">LPCO no Portal Único (DUIMP)</h3><table class="br">`;
      r.lpco.slice(0, 8).forEach(l => {
        h += `<tr><td><b>${esc(l.orgao)}</b>${l.modelo ? ' — ' + esc(l.modelo) : ''}
          <span class="ref">TA ${esc(l.ta)} · aplica-se a ${l.prefixo}</span></td>
          <td>${esc(l.tipo || '')}</td></tr>`;
      });
      h += `</table>`;
    }

    if (!r.ta.length && !r.lpco.length && !r.antidumping.length) {
      h += `<p class="hint">Nenhuma anuência nem antidumping localizado para esta NCM na base embarcada. Ainda assim, confirme certificação compulsória (INMETRO) e rotulagem antes de importar.</p>`;
    }
    h += `</div>`;
    return h;
  }

  /* ============================================================
     ASSISTENTE GUIADO
     Para quem não sabe comex. A pessoa escolhe categoria, produto e
     material; o app resolve a NCM. Quando o código ainda não é folha,
     ele desce na árvore oficial e usa o texto da própria tabela como
     pergunta — assim a redação é da Receita, não minha.
     ============================================================ */
  let PRODUTOS = null;                       // data/produtos.json
  let guia = { cat: null, prod: null, cod: null, caminho: [] };

  function carregarProdutos() {
    return fetch('data/produtos.json').then(r => r.json()).then(j => { PRODUTOS = j; });
  }

  function gReset() { guia = { cat: null, prod: null, cod: null, caminho: [] }; renderGuia(); }

  /* pula direto para a pergunta de material de um produto do dicionário —
     é o atalho de quem veio pela sugestão da foto */
  function gIrParaProduto(nome) {
    if (!PRODUTOS) return;
    const p = PRODUTOS.produtos.find(x => x.n === nome);
    if (!p) { toast('Produto não encontrado no dicionário'); return; }
    guia = { cat: p.cat, prod: p, cod: null, caminho: [] };
    $$('#ncm-modo button').forEach(x => x.classList.toggle('on', x.dataset.v === 'guiado'));
    $('#m-guiado').hidden = false;
    $('#m-busca').hidden = true;
    ir('ncm');
    renderGuia();
  }

  function renderGuia() {
    if (!PRODUTOS) { $('#g-corpo').innerHTML = '<p class="hint">carregando…</p>'; return; }
    renderTrilha();
    if (!guia.cat) return gCategorias();
    if (!guia.prod) return gProdutos();
    if (!guia.cod) return gPergunta();
    return gDescer();
  }

  function renderTrilha() {
    const t = [];
    t.push(`<button data-ir="inicio" class="${!guia.cat ? 'on' : ''}">Início</button>`);
    if (guia.cat) {
      const c = PRODUTOS.categorias.find(x => x.id === guia.cat);
      t.push('<span>›</span>');
      t.push(`<button data-ir="cat" class="${!guia.prod ? 'on' : ''}">${esc(c.nome)}</button>`);
    }
    if (guia.prod) {
      t.push('<span>›</span>');
      t.push(`<button data-ir="prod" class="${!guia.cod ? 'on' : ''}">${esc(guia.prod.n.split(' / ')[0])}</button>`);
    }
    $('#g-trilha').innerHTML = t.join('');
    $('#g-trilha').querySelectorAll('[data-ir]').forEach(b => b.onclick = () => {
      if (b.dataset.ir === 'inicio') gReset();
      else if (b.dataset.ir === 'cat') { guia.prod = null; guia.cod = null; guia.caminho = []; renderGuia(); }
      else { guia.cod = null; guia.caminho = []; renderGuia(); }
    });
  }

  function gCategorias() {
    const alvo = alvoProduto ? produtos.find(p => p.id === alvoProduto) : null;
    $('#g-corpo').innerHTML =
      (alvo ? `<div class="card tight" style="background:#172e5c;border-color:#2b4ba8;margin-bottom:12px">
        <b>Classificando:</b> ${esc(alvo.nome)}<small>escolha a categoria do produto</small></div>` : '')
      + `<p class="pergunta">O que é o produto?</p><div class="grade">`
      + PRODUTOS.categorias.map(c =>
        `<button data-cat="${c.id}"><span class="ico">${c.ico}</span>${esc(c.nome)}</button>`).join('')
      + `</div>`;
    $('#g-corpo').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      guia.cat = b.dataset.cat; renderGuia();
    });
  }

  function gProdutos() {
    const lista = PRODUTOS.produtos.filter(p => p.cat === guia.cat);
    $('#g-corpo').innerHTML = `<p class="pergunta">Qual deles?</p><div class="opcoes">`
      + lista.map((p, i) => `<button data-p="${i}">
          <span>${esc(p.n)}<small>${esc((p.alt || []).slice(0, 4).join(' · '))}</small></span>
          <span class="seta">›</span></button>`).join('')
      + `</div>
         <button class="ghost" id="g-nao" style="margin-top:12px">Não achei meu produto aqui</button>`;
    $('#g-corpo').querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      guia.prod = lista[+b.dataset.p]; renderGuia();
    });
    $('#g-nao').onclick = gNaoAchei;
  }

  function gPergunta() {
    const p = guia.prod;
    $('#g-corpo').innerHTML = `<p class="pergunta">${esc(p.q)}</p><div class="opcoes">`
      + p.op.map((o, i) => `<button data-o="${i}"><span>${esc(o[0])}</span><span class="seta">›</span></button>`).join('')
      + `</div>
         <p class="hint">Na dúvida sobre o material, pergunte ao expositor. É o material que define a NCM —
         a mesma caneca em porcelana, cerâmica, plástico ou vidro tem quatro códigos e quatro impostos diferentes.</p>
         <button class="ghost" id="g-nao" style="margin-top:12px">Nenhuma dessas</button>`;
    $('#g-corpo').querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
      guia.cod = p.op[+b.dataset.o][1];
      guia.caminho = [p.op[+b.dataset.o][0]];
      renderGuia();
    });
    $('#g-nao').onclick = gNaoAchei;
  }

  /* desce na árvore da NCM até chegar num código de 8 dígitos */
  function gDescer() {
    const filhos = BASE.itensPorPrefixo(guia.cod);
    if (!filhos.length) { $('#g-corpo').innerHTML = '<p class="warn">Código não encontrado na base.</p>'; return; }
    if (filhos.length === 1) return gResultado(filhos[0].ncm);
    if (guia.cod.length === 8) return gResultado(guia.cod);

    // agrupa pelo próximo nível da árvore oficial
    const nivel = guia.cod.length < 6 ? 6 : 8;
    const grupos = new Map();
    filhos.forEach(it => {
      const k = it.ncm.slice(0, nivel);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(it);
    });
    if (grupos.size === 1 && nivel < 8) { guia.cod = Array.from(grupos.keys())[0]; return gDescer(); }

    const ops = Array.from(grupos.entries()).map(([k, its]) => ({
      cod: k,
      txt: its.length === 1 ? its[0].desc : (BASE.item(k) ? BASE.item(k).desc : its[0].path.split(' > ').pop() || its[0].desc),
      n: its.length
    }));
    $('#g-corpo').innerHTML = `<p class="pergunta">Qual destes descreve melhor?</p>
      <p class="hint" style="margin:0 0 11px">Texto oficial da tabela NCM. Se nenhum servir exatamente, escolha "Outros".</p>
      <div class="opcoes">`
      + ops.map((o, i) => `<button data-d="${i}">
          <span>${esc(o.txt)}<small>NCM ${o.cod}${o.n > 1 ? ' · ' + o.n + ' subitens' : ''}</small></span>
          <span class="seta">›</span></button>`).join('')
      + `</div>`;
    $('#g-corpo').querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
      guia.cod = ops[+b.dataset.d].cod;
      guia.caminho.push(ops[+b.dataset.d].txt);
      renderGuia();
    });
  }

  function gResultado(ncm) {
    const alvo = alvoProduto ? produtos.find(p => p.id === alvoProduto) : null;
    const it = BASE.item(ncm);
    const r = BASE.risco(ncm, {
      cond: alvo ? alvo.cond : 'novo',
      texto: (alvo ? alvo.nome + ' ' + alvo.desc + ' ' : '') + guia.prod.n
    });
    const pc = CUSTOS.pisCofinsDe(ncm);
    // soma dos federais: II + IPI (sobre VA+II) + PIS + COFINS, em pontos do VA
    const somaFed = (typeof it.ii === 'number')
      ? it.ii + (typeof it.ipi === 'number' ? it.ipi * (1 + it.ii / 100) : 0) + pc.pis + pc.cofins
      : null;
    const ALERTA = {
      bad: 'Cuidado sério antes de comprar',
      mid: 'Precisa de licença antes de embarcar',
      warn: 'Tem exigência a verificar',
      ok: 'Nenhuma barreira encontrada'
    };
    const expl = {
      bad: r.antidumping.length
        ? 'Existe antidumping para esse tipo de produto vindo da China. É um imposto extra que entra por fora e pode passar de 100% do valor. Não feche pedido sem falar com o Leonardo.'
        : 'A importação desse item está impedida ou muito restrita. Fale com o Leonardo antes de negociar.',
      mid: 'Esse produto exige licença de um órgão do governo ANTES do embarque na China. Dá para importar, mas o processo é mais lento e tem custo. Avise o Leonardo.',
      warn: 'Há exigência administrativa ou condição a confirmar. Dá para seguir, mas registre e mostre ao Leonardo.',
      ok: 'Nada foi encontrado na base. Ainda assim o Leonardo deve confirmar antes de um pedido grande.'
    };

    let custoHtml = '';
    if (alvo && alvo.preco > 0 && (alvo.qtd || alvo.moq)) {
      const c = CUSTOS.calcular(Object.assign({}, alvo, { ncm: ncm, ii: it.ii, ipi: it.ipi }), cfg);
      custoHtml = `<div class="kpi" style="margin-bottom:12px">
        <div><div class="k-l">Custo por peça</div><div class="k-v hi">${brl(c.unit)}</div>
          <div class="k-s">posto no Brasil</div></div>
        <div><div class="k-l">Multiplicador</div><div class="k-v">${c.multiplo.toFixed(2)}×</div>
          <div class="k-s">sobre o preço do estande</div></div></div>`;
    }

    $('#g-corpo').innerHTML = `
      <div class="achou">
        <div class="ncm">${fmtNcm(ncm)}</div>
        <div class="dsc">${esc(it.desc)}</div>
        <div class="nums">
          <div>Imp. Importação<b>${it.ii === null ? '—' : it.ii + '%'}</b></div>
          <div>IPI<b>${it.ipi === 'NT' ? 'NT' : (it.ipi === null ? '—' : it.ipi + '%')}</b></div>
          <div>PIS<b>${pc.pis}%</b></div>
          <div>COFINS<b>${pc.cofins}%</b></div>
        </div>
        <div class="nums" style="border-top:1px solid rgba(255,255,255,.18);margin-top:11px;padding-top:10px">
          <div>Tributos federais<b>${somaFed === null ? '—' : somaFed.toFixed(2).replace('.', ',') + '%'}</b></div>
          <div>+ ICMS ${cfg.icmsPct}%<b style="font-size:15px">no cálculo de custo</b></div>
          ${r.orgaos.length ? `<div>Órgãos<b style="font-size:15px">${esc(r.orgaos.join(' '))}</b></div>` : ''}
        </div>
        ${pc.especial ? `<div class="dsc" style="margin-top:10px;color:#fde68a">
          <b style="color:#fde68a">Atenção:</b> esta NCM está no regime especial de PIS/COFINS
          (${esc(pc.regime)}, Lei 10.865/2004) — ${(pc.pis + pc.cofins).toFixed(2).replace('.', ',')}%
          em vez dos 11,75% da regra geral.</div>` : ''}
      </div>
      <div class="alerta ${r.nivel}"><b>${ALERTA[r.nivel]}</b>${expl[r.nivel]}</div>
      ${custoHtml}
      ${alvo ? `<button class="primary big" id="g-atribuir">Salvar esta NCM em "${esc(alvo.nome)}"</button>`
             : `<button class="primary big" id="g-escolher">Salvar em um produto</button>`}
      <button class="ghost" id="g-detalhe" style="margin-top:9px">Ver detalhe técnico (para o Leonardo)</button>
      <button class="ghost" id="g-outro" style="margin-top:0">Classificar outro produto</button>`;

    const ba = $('#g-atribuir');
    if (ba) ba.onclick = () => { atribuir(alvo, r); gReset(); };
    const be = $('#g-escolher');
    if (be) be.onclick = () => {
      if (!produtos.length) { toast('Salve um produto primeiro, na aba Capturar'); return; }
      modal(`<h3>Salvar ${fmtNcm(ncm)} em qual produto?</h3><div class="lista">`
        + produtos.map(p => `<div class="it" data-sel="${p.id}"><div class="it-nome">${esc(p.nome)}</div>
            <div class="it-sub">${esc(p.forn || '')}${p.ncm ? ' · hoje: ' + p.ncm : ''}</div></div>`).join('')
        + '</div>');
      $('#modal-body').querySelectorAll('[data-sel]').forEach(c => c.onclick = () => {
        atribuir(produtos.find(p => p.id === c.dataset.sel), r); gReset();
      });
    };
    $('#g-detalhe').onclick = () => modal(blocoRisco(r));
    $('#g-outro').onclick = gReset;
  }

  function gNaoAchei() {
    const alvo = alvoProduto ? produtos.find(p => p.id === alvoProduto) : null;
    $('#g-corpo').innerHTML = `
      <div class="alerta warn"><b>Sem problema</b>
        O dicionário cobre os produtos mais comuns da feira, não todos. Faça assim:
        tire as fotos, anote o material e as medidas na aba <b>Capturar</b>, e marque para o Leonardo
        classificar. Não precisa adivinhar — chute em classificação fiscal custa caro.</div>
      ${alvo ? `<button class="primary big" id="g-marcar">Marcar "${esc(alvo.nome)}" para o Leonardo ver</button>` : ''}
      <button class="ghost" id="g-voltar" style="margin-top:9px">Voltar e procurar de novo</button>`;
    const bm = $('#g-marcar');
    if (bm) bm.onclick = () => {
      alvo.paraRevisar = true;
      alvo.atualizado = Date.now();
      DB.salvarProduto(alvo).then(() => {
        alvoProduto = null; toast('Marcado para o Leonardo revisar'); gReset(); ir('produtos');
      });
    };
    $('#g-voltar').onclick = () => { guia.cod = null; guia.prod = null; renderGuia(); };
  }

  /* ---------------- busca NCM ---------------- */
  let alvoProduto = null;
  const SUGESTOES = ['ceramic mug', 'tableware porcelain', 'led lamp', 'furniture wood chair',
    'towel cotton', 'sneaker', 'backpack', 'pen', 'cosmetic cream', 'toy plastic',
    'curtain', 'mirror', 'fan', 'speaker bluetooth'];

  function renderSugestoes() {
    $('#q-sug').innerHTML = SUGESTOES.map(s => `<span class="chip" data-q="${esc(s)}">${esc(s)}</span>`).join('');
    $('#q-sug').querySelectorAll('[data-q]').forEach(c => c.onclick = () => {
      $('#q').value = c.dataset.q; buscarNcm();
    });
  }

  let buscaT;
  function buscarNcmDebounce() { clearTimeout(buscaT); buscaT = setTimeout(buscarNcm, 170); }

  function buscarNcm() {
    const q = $('#q').value;
    const el = $('#q-res');
    if (!q.trim()) {
      $('#q-ctx').textContent = BASE.totalItens().toLocaleString('pt-BR') + ' códigos NCM na memória do aparelho';
      el.innerHTML = `<div class="empty">Descreva o produto em português ou inglês.<br>
        Ex.: <b>ceramic mug</b>, <b>luminária led</b>, <b>tênis</b>, <b>6912</b></div>`;
      renderSugestoes();
      return;
    }
    const { itens, expandido } = BASE.buscar(q, 30);
    $('#q-ctx').textContent = itens.length
      ? `${itens.length} resultado(s)` + (expandido.length ? ' · ' + expandido.slice(0, 3).join(' · ') : '')
      : 'Nada encontrado — tente outra palavra ou o código NCM';
    $('#q-sug').innerHTML = '';
    if (!itens.length) {
      el.innerHTML = `<div class="empty">Sem resultado.<br>Tente o termo em português, um sinônimo, ou digite os 4 primeiros dígitos da NCM.</div>`;
      return;
    }
    const alvo = alvoProduto ? produtos.find(p => p.id === alvoProduto) : null;
    el.innerHTML = (alvo ? `<div class="card tight" style="background:#172e5c;border-color:#2b4ba8">
        <b>Classificando:</b> ${esc(alvo.nome)}
        <small>toque no código certo para atribuir</small></div>` : '')
      + itens.map(({ it }) => {
        const r = BASE.risco(it.ncm, { cond: alvo ? alvo.cond : 'novo', texto: q + ' ' + it.desc });
        return `<div class="it" data-ncm="${it.ncm}">
          <div class="it-top"><div class="it-b">
            <div class="it-nome"><span class="code">${fmtNcm(it.ncm)}</span> · ${esc(it.desc)}</div>
            <div class="it-sub">${esc(BASE.capitulo(it.cap))}${it.path ? ' › ' + esc(it.path) : ''}</div>
          </div></div>
          <div class="it-foot">
            <span class="tag tag-ac">II ${it.ii === null ? '?' : it.ii + '%'}</span>
            <span class="tag">IPI ${it.ipi === null ? '?' : (it.ipi === 'NT' ? 'NT' : it.ipi + '%')}</span>
            <span class="tag ${NIVEL_TAG[r.nivel]}">${esc(r.rotulo)}</span>
            ${r.orgaos.slice(0, 2).map(o => `<span class="tag">${esc(o)}</span>`).join('')}
          </div></div>`;
      }).join('');
    el.querySelectorAll('[data-ncm]').forEach(c => c.onclick = () => abrirNcm(c.dataset.ncm));
  }

  const fmtNcm = (n) => n.slice(0, 4) + '.' + n.slice(4, 6) + '.' + n.slice(6, 8);

  function abrirNcm(ncm) {
    const alvo = alvoProduto ? produtos.find(p => p.id === alvoProduto) : null;
    const r = BASE.risco(ncm, {
      cond: alvo ? alvo.cond : 'novo',
      texto: (alvo ? alvo.nome + ' ' + alvo.desc + ' ' : '') + $('#q').value
    });
    modal(blocoRisco(r) + `<div style="margin-top:14px">
      ${alvo ? `<button class="primary" id="n-atribuir">Atribuir ao produto "${esc(alvo.nome)}"</button>` : ''}
      ${!alvo && produtos.length ? `<button class="ghost" id="n-escolher">Atribuir a um produto salvo</button>` : ''}
      <button class="ghost" id="n-simular">Simular custo com esta NCM</button>
    </div>`);
    const ba = $('#n-atribuir');
    if (ba) ba.onclick = () => atribuir(alvo, r);
    const be = $('#n-escolher');
    if (be) be.onclick = () => {
      modal(`<h3>Atribuir ${fmtNcm(ncm)} a qual produto?</h3><div class="lista">` +
        produtos.map(p => `<div class="it" data-sel="${p.id}"><div class="it-nome">${esc(p.nome)}</div>
          <div class="it-sub">${esc(p.forn || '')} ${p.ncm ? '· hoje: ' + p.ncm : ''}</div></div>`).join('') + '</div>');
      $('#modal-body').querySelectorAll('[data-sel]').forEach(c => c.onclick = () =>
        atribuir(produtos.find(p => p.id === c.dataset.sel), r));
    };
    $('#n-simular').onclick = () => { fecharModal(); simularSolto(r); };
  }

  function atribuir(p, r) {
    if (!p) return;
    p.ncm = r.ncm;
    p.ncmDesc = r.item ? r.item.desc : '';
    p.ii = r.item ? r.item.ii : null;
    p.ipi = r.item ? r.item.ipi : null;
    p.atualizado = Date.now();
    DB.salvarProduto(p).then(() => {
      alvoProduto = null; fecharModal();
      toast('NCM ' + fmtNcm(r.ncm) + ' atribuída a ' + p.nome);
      ir('produtos');
    });
  }

  /* ---------------- custos ---------------- */
  function renderSelectCustos() {
    const s = $('#c-produto');
    const atual = s.value;
    const classificados = produtos.filter(p => p.ncm);
    s.innerHTML = '<option value="">— escolha um produto salvo —</option>' +
      classificados.map(p => `<option value="${p.id}">${esc(p.nome)}${p.forn ? ' — ' + esc(p.forn) : ''}</option>`).join('');
    if (atual) s.value = atual;
    if (!classificados.length) {
      $('#c-saida').innerHTML = `<div class="empty">${produtos.length
        ? 'Nenhum produto classificado ainda.<br>Atribua uma NCM na aba <b>NCM</b>.'
        : 'Salve um produto primeiro, em <b>Capturar</b>.'}</div>`;
      return;
    }
    renderCustos();
  }

  function renderCustos() {
    const p = produtos.find(x => x.id === $('#c-produto').value);
    const el = $('#c-saida');
    if (!p) { el.innerHTML = '<div class="empty">Escolha um produto acima.</div>'; return; }
    const aviso = (!p.qtd && !p.moq)
      ? `<div class="card tight"><p class="warn">Produto sem quantidade: a conta está usando 1 peça,
         então o frete e as despesas fixas caem todos em cima dela. Preencha MOQ ou quantidade.</p></div>`
      : '';
    el.innerHTML = aviso + extratoHtml(p, CUSTOS.calcular(p, cfg));
  }

  function simularSolto(r) {
    const fake = {
      nome: 'Simulação', preco: 1, moeda: 'USD', qtd: 1000, peso: 0.3, cbm: 0.002,
      ii: r.item ? r.item.ii : 0, ipi: r.item ? r.item.ipi : 0, cond: 'novo', desc: ''
    };
    ir('custos');
    $('#c-saida').innerHTML = `<div class="card tight" style="background:#172e5c;border-color:#2b4ba8">
      <b>Simulação rápida</b><small>NCM ${fmtNcm(r.ncm)} · 1.000 un × USD 1,00 · 0,3 kg · 0,002 m³ por peça.
      Serve para ver a carga tributária; salve um produto real para a conta valer.</small></div>`
      + extratoHtml(fake, CUSTOS.calcular(fake, cfg));
  }

  function extratoHtml(p, c) {
    const g = (nome) => c.linhas.filter(l => l.grupo === nome);
    const linhas = (arr) => arr.map(l =>
      `<tr><td>${esc(l.rotulo)}${l.ref ? `<span class="ref">${esc(l.ref)}</span>` : ''}</td><td>${brl(l.valor)}</td></tr>`).join('');
    const vendaNec = CUSTOS.precoVenda(c.unitLiquido, cfg.margemAlvo);

    return `
      <div class="kpi">
        <div><div class="k-l">Custo por peça</div><div class="k-v hi">${brl(c.unit)}</div>
          <div class="k-s">${c.qtd.toLocaleString('pt-BR')} peças · total ${brl(c.total)}</div></div>
        <div><div class="k-l">Líquido de créditos</div><div class="k-v">${brl(c.unitLiquido)}</div>
          <div class="k-s">${c.aproveita ? 'créditos ' + brl(c.creditos) : 'Simples: sem crédito'}</div></div>
        <div><div class="k-l">Multiplicador do FOB</div><div class="k-v">${c.multiplo.toFixed(2)}×</div>
          <div class="k-s">líquido ${c.multiploLiquido.toFixed(2)}×</div></div>
        <div><div class="k-l">Carga tributária</div><div class="k-v">${c.cargaPct.toFixed(1)}%</div>
          <div class="k-s">sobre o valor aduaneiro</div></div>
      </div>

      <div class="card">
        <h3>Mercadoria e chegada</h3>
        <table class="br">${linhas(g('merc'))}
          <tr class="sum"><td>Valor aduaneiro</td><td>${brl(c.VA)}</td></tr></table>
      </div>

      <div class="card">
        <h3>Tributos</h3>
        <table class="br">${linhas(g('trib'))}
          <tr class="sum"><td>Total de tributos</td><td>${brl(c.tributos)}</td></tr></table>
      </div>

      <div class="card">
        <h3>Encargos e despesas</h3>
        <table class="br">${linhas(g('enc'))}</table>
      </div>

      <div class="card">
        <h3>Resultado</h3>
        <table class="br">
          <tr><td>Desembolso total</td><td>${brl(c.total)}</td></tr>
          ${c.creditoLinhas.map(x => `<tr class="sub"><td>− ${esc(x.rotulo)}${x.ref ? `<span class="ref">${esc(x.ref)}</span>` : ''}</td><td>−${brl(x.valor)}</td></tr>`).join('')}
          ${c.icmsAcumulado > 0.01 ? `<tr class="sub"><td>ICMS que fica acumulado
            <span class="ref">crédito sem débito de saída para absorver</span></td>
            <td>${brl(c.icmsAcumulado)}</td></tr>` : ''}
          <tr class="sum"><td>Custo efetivo</td><td>${brl(c.liquido)}</td></tr>
          <tr><td>Custo efetivo por peça</td><td>${brl(c.unitLiquido)}</td></tr>
          <tr><td>Preço de venda p/ ${cfg.margemAlvo}% de margem<span class="ref">margem sobre o preço de venda</span></td><td>${brl(vendaNec)}</td></tr>
        </table>
        <p class="hint">Previsão, não cotação. Frete, despesas locais e câmbio são estimativas suas;
        o ICMS depende da UF e de regime especial. Antidumping, quando existe, entra por fora e pode
        dobrar o custo — confira o bloco de risco da NCM.</p>
      </div>`;
  }

  /* ---------------- config ---------------- */
  const MAP_CFG = {
    'k-usd': 'usdBrl', 'k-cny': 'cnyBrl', 'k-icms': 'icmsPct', 'k-regime': 'regime',
    'k-data': 'dataRef', 'k-modal': 'modal', 'k-frete': 'freteUsd', 'k-seguro': 'seguroPct',
    'k-desp': 'despesasBrl', 'k-siscomex': 'siscomexBrl', 'k-saida': 'aliqSaidaPct'
  };

  function avisoSaida() {
    const inter = Number(cfg.aliqSaidaPct) < Number(cfg.icmsPct);
    $('#saida-aviso').textContent = inter
      ? `Atenção: você paga ${cfg.icmsPct}% de ICMS no desembaraço e debita só `
        + `${cfg.aliqSaidaPct}% na saída. A diferença vira crédito acumulado, que demora a `
        + `virar dinheiro. O app passa a abater só a parte do crédito que a venda absorve.`
      : `Saída a ${cfg.aliqSaidaPct}%: o crédito de ICMS da importação tende a ser absorvido pela venda.`;
  }

  function pintarConfig() {
    const uf = $('#k-uf');
    uf.innerHTML = Object.keys(UF_ICMS).sort().map(u =>
      `<option value="${u}">${u}</option>`).join('');
    uf.value = cfg.uf;
    Object.entries(MAP_CFG).forEach(([id, k]) => { const e = $('#' + id); if (e) e.value = cfg[k]; });
    $('#k-capatazia').checked = !!cfg.capatazia;
    avisoIcms();
    avisoSaida();
    $('#k-fontes').innerHTML = (() => {
      const m = BASE.meta();
      return `<div><b>Versão do app</b><br>${esc(VERSAO)}</div>
        <div><b>NCM / TEC — Imposto de Importação</b><br>${esc(m.fiscal.tec_ato)}</div>
        <div><b>TIPI — IPI</b><br>${esc(m.fiscal.tipi_ato)}</div>
        <div><b>Tratamento administrativo / anuentes</b><br>${esc(m.anuencia.fonte)}</div>
        <div><b>Antidumping</b><br>${esc(m.antidumping.fonte)} — ${m.antidumping.total} medidas, ${m.antidumping.total_china} envolvendo a China</div>
        <div><b>Base baixada em</b> ${esc(m.fiscal.gerado)} · ${BASE.totalItens().toLocaleString('pt-BR')} códigos NCM</div>`;
    })();
  }

  function avisoIcms() {
    $('#icms-aviso').textContent = `Padrão de ${cfg.uf}: ${UF_ICMS[cfg.uf]}%. Confirme a sua — vários estados `
      + `alteraram a alíquota em 2025/2026 e há regimes especiais de importação por UF que mudam muito a conta.`;
  }

  function ligarConfig() {
    Object.entries(MAP_CFG).forEach(([id, k]) => {
      const e = $('#' + id); if (!e) return;
      e.oninput = e.onchange = () => {
        const num = e.type === 'number';
        cfg[k] = (num || k === 'aliqSaidaPct') ? (parseFloat(e.value) || 0) : e.value;
        DB.setCfg(k, cfg[k]);
        if (k === 'aliqSaidaPct') avisoSaida();
      };
    });
    $('#k-uf').onchange = () => {
      cfg.uf = $('#k-uf').value;
      cfg.icmsPct = UF_ICMS[cfg.uf];
      $('#k-icms').value = cfg.icmsPct;
      DB.setCfg('uf', cfg.uf); DB.setCfg('icmsPct', cfg.icmsPct);
      avisoIcms(); avisoSaida();
    };
    $('#k-capatazia').onchange = () => { cfg.capatazia = $('#k-capatazia').checked; DB.setCfg('capatazia', cfg.capatazia); };
    $('#btn-teste').onclick = testarOffline;
    $('#btn-reset').onclick = () => {
      if (!confirm('Isso apaga TODOS os produtos, fotos e configurações deste aparelho. Continuar?')) return;
      DB.limparTudo().then(() => location.reload());
    };
  }

  /* ---------------- autoteste de offline ----------------
     O service worker é o que faz o app abrir sem rede. Ele não pode ser
     verificado por mim de fora: depende do navegador e do aparelho de vocês.
     Então o app se testa sozinho, aqui, antes da viagem.                   */
  function perguntarAoSw() {
    return new Promise((ok) => {
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!sw) return ok(null);
      const t = setTimeout(() => ok(null), 2500);
      const ouvir = (e) => {
        if (e.data && e.data.tipo === 'estado-cache') {
          clearTimeout(t);
          navigator.serviceWorker.removeEventListener('message', ouvir);
          ok(e.data);
        }
      };
      navigator.serviceWorker.addEventListener('message', ouvir);
      sw.postMessage('estado-cache');
    });
  }

  function testarOffline() {
    const out = $('#teste-saida');
    out.innerHTML = '<p class="hint">testando…</p>';
    const linha = (ok, txt, detalhe) =>
      `<tr><td>${esc(txt)}${detalhe ? `<span class="ref">${esc(detalhe)}</span>` : ''}</td>
       <td><span class="tag ${ok ? 'tag-ok' : 'tag-bad'}">${ok ? 'ok' : 'falhou'}</span></td></tr>`;

    Promise.all([
      navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null),
      perguntarAoSw(),
      caches.keys().then(ks => ks.length
        ? caches.open(ks.find(k => k.startsWith('canton-scout')) || ks[0]).then(c => c.keys())
        : []),
      navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
      DB.espaco(),
      // o modelo de visão é o pedaço mais pesado: confirma que baixou
      caches.keys().then(ks => ks.length
        ? caches.open(ks[0]).then(c => c.match('modelo/group1-shard4of4')).then(m => !!m)
        : false).catch(() => false)
    ]).then(([reg, estado, chaves, persistido, esp, temModelo]) => {
      const temSw = !!(reg && reg.active);
      const nCache = estado ? estado.total : chaves.length;
      const esperado = estado ? estado.esperado : 24;
      const cacheOk = nCache >= esperado;
      const mb = esp && esp.usage ? (esp.usage / 1048576).toFixed(1) + ' MB usados' : '';
      const tudoOk = temSw && cacheOk;

      out.innerHTML = `
        <table class="br" style="margin-top:12px">
          ${linha(true, 'Versão instalada', VERSAO)}
          ${linha(temSw, 'Service worker instalado', temSw ? 'o app abre sem rede' : 'sem ele o app NÃO abre offline')}
          ${linha(cacheOk, 'Base fiscal gravada no aparelho', nCache + ' de ' + esperado + ' arquivos em cache')}
          ${linha(temModelo, 'Reconhecimento por foto', temModelo
            ? 'modelo de visão gravado — a foto é classificada no aparelho'
            : 'modelo NÃO baixado — a foto não vai ser reconhecida')}
          ${linha(persistido, 'Armazenamento persistente', persistido
            ? 'o navegador não vai apagar suas fotos'
            : 'o navegador pode apagar os dados se faltar espaço — instale o app na tela inicial')}
        </table>
        <div class="card tight" style="margin-top:10px;background:${tudoOk ? '#0d3320' : '#43161a'};border-color:${tudoOk ? '#1d6b3f' : '#7a2a2a'}">
          <b>${tudoOk ? 'Pronto para a China.' : 'Ainda NÃO está pronto.'}</b>
          <small>${tudoOk
            ? 'Para confirmar de verdade: ative o modo avião, feche o app e abra de novo. Tem que abrir normal. ' + mb
            : 'Abra o app pelo endereço https (não por arquivo), instale na tela inicial pelo menu do navegador, recarregue uma vez e teste de novo.'}</small>
        </div>`;
    }).catch(e => { out.innerHTML = `<p class="warn">Erro no teste: ${esc(e.message)}</p>`; });
  }

  /* ---------------- exportar / importar ---------------- */
  function baixar(nome, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const hoje = () => new Date().toISOString().slice(0, 10);

  function exportarJson() {
    DB.todasMidias().then(ms => {
      // blob -> base64 para caber num arquivo único
      const lerB64 = (b) => new Promise(ok => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.readAsDataURL(b);
      });
      return Promise.all(ms.map(m => lerB64(m.blob).then(d => ({
        id: m.id, produtoId: m.produtoId, tipo: m.tipo, nome: m.nome, dados: d
      }))));
    }).then(midias => {
      const pacote = { app: 'canton-scout', versao: 1, exportado: new Date().toISOString(), cfg, produtos, midias };
      baixar(`canton-scout-${hoje()}.json`, new Blob([JSON.stringify(pacote)], { type: 'application/json' }));
      toast('Backup gerado — guarde no notebook');
    });
  }

  function exportarCsv() {
    const cab = ['Produto', 'NCM', 'Descrição NCM', 'II %', 'IPI %', 'Risco', 'Órgãos anuentes',
      'Antidumping', 'Fornecedor', 'Estande', 'Fase', 'Contato', 'Moeda', 'Preço FOB', 'MOQ',
      'Qtd', 'Peso kg', 'CBM', 'Custo/un BRL', 'Custo efetivo/un BRL', 'Multiplicador FOB', 'Observações'];
    const linhas = produtos.map(p => {
      const r = p.ncm ? BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }) : null;
      const c = (p.ncm && typeof p.ii === 'number') ? CUSTOS.calcular(p, cfg) : null;
      return [p.nome, p.ncm || '', p.ncmDesc || '',
        typeof p.ii === 'number' ? p.ii : '', p.ipi === 'NT' ? 'NT' : (typeof p.ipi === 'number' ? p.ipi : ''),
        r ? r.rotulo : 'sem NCM', r ? r.orgaos.join(' / ') : '',
        r ? r.antidumping.map(m => m.prod).join(' / ') : '',
        p.forn, p.estande, p.fase, p.contato, p.moeda, p.preco, p.moq, p.qtd, p.peso, p.cbm,
        c ? c.unit.toFixed(2) : '', c ? c.unitLiquido.toFixed(2) : '', c ? c.multiplo.toFixed(2) : '',
        p.obs];
    });
    const cel = (v) => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(cel).join(';')).join('\r\n');
    baixar(`canton-scout-${hoje()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    toast('Planilha gerada (abre no Excel)');
  }

  function importarJson(file) {
    const fr = new FileReader();
    fr.onload = () => {
      let d; try { d = JSON.parse(fr.result); } catch (e) { toast('Arquivo inválido'); return; }
      if (d.app !== 'canton-scout') { toast('Não é um backup do Canton Scout'); return; }
      const b64Blob = (dataUrl) => fetch(dataUrl).then(r => r.blob());
      Promise.all((d.produtos || []).map(p => DB.salvarProduto(p)))
        .then(() => Promise.all((d.midias || []).map(m => b64Blob(m.dados).then(b =>
          DB.salvarMidia({ id: m.id, produtoId: m.produtoId, blob: b, tipo: m.tipo, nome: m.nome })))))
        .then(() => DB.listarProdutos())
        .then(ps => { produtos = ps; atualizaContador(); renderProdutos(); toast('Backup importado: ' + ps.length + ' produtos'); });
    };
    fr.readAsText(file);
  }

  /* ---------------- boot ---------------- */
  function rede() {
    const p = $('#net-pill');
    const on = navigator.onLine;
    p.textContent = on ? 'online' : 'offline';
    p.className = 'pill ' + (on ? 'pill-on' : 'pill-off');
  }

  function iniciar() {
    const msg = $('#splash-msg'), bar = $('#splash-bar');

    // pede armazenamento persistente: sem isso o navegador pode apagar as fotos
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    BASE.carregar((m, p) => { msg.textContent = m; bar.style.width = p + '%'; })
      .then(() => carregarProdutos())
      .then(() => DB.todaCfg())
      .then(salva => {
        cfg = Object.assign({}, CUSTOS.CFG_PADRAO, salva);
        return DB.listarProdutos();
      })
      .then(ps => {
        produtos = ps || [];
        atualizaContador();
        pintarConfig(); ligarConfig();
        buscarNcm();
        $('#splash').classList.add('off');
        setTimeout(() => $('#splash').remove(), 400);
      })
      .catch(e => {
        msg.innerHTML = 'Falha ao carregar a base:<br><b>' + esc(e.message) + '</b><br><br>'
          + 'Abra o app por um servidor (http/https), não por arquivo solto.';
      });

    // navegação
    $$('#tabs button').forEach(b => b.onclick = () => ir(b.dataset.v));
    // captura
    $('#cam').onchange = (e) => { receberArquivos(e.target.files); e.target.value = ''; };
    $('#gal').onchange = (e) => { receberArquivos(e.target.files); e.target.value = ''; };
    $('#btn-salvar').onclick = salvarProduto;
    $$('#f-cond button').forEach(b => b.onclick = () => {
      $$('#f-cond button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); condAtual = b.dataset.v;
    });
    // produtos
    $('#p-filtro').oninput = renderProdutos;
    $$('#p-ord button').forEach(b => b.onclick = () => {
      $$('#p-ord button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); ordem = b.dataset.v; renderProdutos();
    });
    $('#btn-export-json').onclick = exportarJson;
    $('#btn-export-csv').onclick = exportarCsv;
    $('#imp-json').onchange = (e) => { if (e.target.files[0]) importarJson(e.target.files[0]); e.target.value = ''; };
    // ncm: alterna entre o assistente guiado e a busca por texto
    $$('#ncm-modo button').forEach(b => b.onclick = () => {
      $$('#ncm-modo button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const g = b.dataset.v === 'guiado';
      $('#m-guiado').hidden = !g;
      $('#m-busca').hidden = g;
      if (g) renderGuia();
    });
    $('#q').oninput = buscarNcmDebounce;
    // custos
    $('#c-produto').onchange = renderCustos;
    // modal
    $('#modal-x').onclick = fecharModal;
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') fecharModal(); };
    // rede
    rede();
    window.addEventListener('online', rede);
    window.addEventListener('offline', rede);
    // service worker: é o que garante abrir sem internet
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(reg => {
        // Sem isto, uma versão nova fica presa no cache até a pessoa recarregar
        // duas vezes — e elas não vão saber fazer isso. Com rede, avisa e recarrega.
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          if (!novo) return;
          novo.addEventListener('statechange', () => {
            if (novo.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Versão nova baixada · recarregando…');
              setTimeout(() => location.reload(), 2200);
            }
          });
        });
        if (navigator.onLine) reg.update().catch(() => {});
      }).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
