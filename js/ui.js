/* ============================================================
   ui.js — telas e amarração. Nada aqui depende de rede.
   ============================================================ */
(() => {
  const VERSAO = 'v24 · 24/10/2026 · NCM pela IA';
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
  let notaCaptura = 0;
  let ordem = 'data';
  let ultimaFoto = null;
  let filtroCat = '';            // categoria selecionada na aba Produtos
  let filtroStatus = '';         // situação selecionada na aba Produtos
  const urlCache = new Map();

  /* Situação de cada produto. É o que transforma a lista de capturas num
     funil de trabalho depois da feira — que é quando o garimpo acontece. */
  const STATUS = [
    { id: 'novo',       nome: 'Capturado',     tag: 'tag' },
    { id: 'interesse',  nome: 'Interessado',   tag: 'tag-ac' },
    { id: 'negociando', nome: 'Negociando',    tag: 'tag-warn' },
    { id: 'amostra',    nome: 'Amostra pedida', tag: 'tag-mid' },
    { id: 'fechado',    nome: 'Vou comprar',   tag: 'tag-ok' },
    { id: 'descartado', nome: 'Descartado',    tag: 'tag-bad' }
  ];
  const statusDe = (id) => STATUS.find(s => s.id === (id || 'novo')) || STATUS[0];
  const dataCurta = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    + ' ' + new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
      // uma foto de 12 MP decodificada ocupa ~48 MB: no iPhone, sem soltar,
      // algumas fotos seguidas esgotam a memória do app
      if (bmp) { desenhar(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close(); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); desenhar(img, img.width, img.height); };
      img.onerror = () => { URL.revokeObjectURL(url); ok(file); };
      img.src = url;
    }));
  }

  /* imagem pequena em data URL: é o que viaja junto com o produto */
  function imagemReduzida(blob, lado, q) {
    const decodificar = self.createImageBitmap
      ? createImageBitmap(blob).catch(() => null) : Promise.resolve(null);
    return decodificar.then(bmp => new Promise(ok => {
      const desenhar = (fonte, lw, lh) => {
        const r = Math.min(1, lado / Math.max(lw, lh));
        const c = document.createElement('canvas');
        c.width = Math.round(lw * r); c.height = Math.round(lh * r);
        c.getContext('2d').drawImage(fonte, 0, 0, c.width, c.height);
        try { ok(c.toDataURL('image/jpeg', q)); } catch (e) { ok(null); }
      };
      if (bmp) { desenhar(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close(); return; }
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); desenhar(img, img.width, img.height); };
      img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
      img.src = url;
    }));
  }

  /* Produto sem autor foi cadastrado neste celular: os recebidos ganham o
     autor ao chegar. Compara por nome porque o mesmo aparelho pode receber
     de volta o que ele mesmo cadastrou (app reinstalado, por exemplo). */
  const mesmoNome = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  const ehMeu = (p) => !p.autor || mesmoNome(p.autor, cfg.dispositivo);

  /* miniatura feita na hora de salvar, da foto que ainda está na memória:
     fica dentro do produto e sincroniza, mesmo que o iPhone perca a foto.
     Cartão e placa do estande não são o produto: ficam de fora. */
  const fotoDoProduto = (m) => (m.tipo || '').startsWith('image') && !m.cartao && !m.placa;
  function miniaturaDe(midias) {
    const foto = midias.find(fotoDoProduto);
    return foto ? imagemReduzida(foto.blob, 320, 0.6).catch(() => null) : Promise.resolve(null);
  }

  /* imagem que não abre vira a miniatura, e sem miniatura um espaço
     vazio com ícone de câmera — nunca o "?" do iPhone */
  function semFoto(img, p) {
    img.onerror = () => {
      if (p && p.miniatura && img.getAttribute('src') !== p.miniatura) { img.src = p.miniatura; return; }
      img.onerror = null;
      img.removeAttribute('src');
      img.classList.add('sem-foto');
    };
  }
  const nomeAutor = (p) => p.autor === 'sem nome' ? 'outro celular' : p.autor;

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
      if (foto) {
        reconhecer(foto.blob);
        if (ncmIaFeita !== capturaAtual) classificarCaptura(foto.blob);
      }
      else toast('Vídeo guardado · o reconhecimento só lê foto');
    });
  }

  /* ---------------- reconhecimento pela foto ----------------
     Roda no próprio aparelho. Sugere, nunca decide: o material
     continua sendo pergunta, porque é ele que define a NCM.     */
  function reconhecer(blob) {
    const el = $('#sugestao');
    ultimaFoto = blob;                 // permite reconhecer de novo sob demanda
    el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">
      analisando a foto no aparelho…</p></div>`;
    // Da 2ª foto em diante a pessoa já rolou a tela para preencher preço e
    // fornecedor, e o resultado aparecia fora da vista — parecia que o
    // reconhecimento tinha parado de funcionar.
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
    VISAO.carregar(m => {
      el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">${esc(m)}</p></div>`;
    })
      .then(() => VISAO.classificar(blob, 3))
      .then(({ sugestoes, fracas, termo, bruto, diag }) => {
        if (iaJaClassificou()) { el.innerHTML = ''; return; }
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
          if (termo) {
            el.innerHTML = `<div class="card">
              <h3 style="margin-bottom:4px">Parece ser: ${esc(termo.q)}</h3>
              <p class="hint" style="margin:0 0 9px">O modelo viu <b>${esc(termo.rot)}</b>
              (${Math.round(termo.p * 100)}%), mas esse produto não está no modo Guiado.
              Busque na tabela e confira o texto da NCM antes de escolher.</p>
              <button id="sug-buscar" class="primary">Buscar “${esc(termo.q)}” na NCM</button>
              ${detalhe}</div>`;
            $('#sug-buscar').onclick = () => {
              $$('#ncm-modo button').forEach(x => x.classList.toggle('on', x.dataset.v === 'busca'));
              $('#m-guiado').hidden = true;
              $('#m-busca').hidden = false;
              $('#q').value = termo.q;
              buscarNcm();
              ir('ncm');
            };
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
            return;
          }
          el.innerHTML = `<div class="card">
            <h3 style="margin-bottom:4px">Não reconheci</h3>
            <p class="hint" style="margin:0">${palpite
              ? 'Talvez seja <b>' + esc(palpite.produto) + '</b>, mas a certeza é baixa demais para eu afirmar. '
              : (bruto.length ? 'O que mais pareceu foi <b>' + esc(bruto[0].rot) + '</b>, que não está no dicionário. ' : '')
            }Use a aba <b>NCM</b> no modo Guiado — são três toques.</p>
            ${detalhe}</div>`;
        }

        if (sugestoes.length) toast('Reconheci: ' + sugestoes[0].produto.split(' / ')[0]);
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }

        const alvos = sugestoes;
        el.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => {
          const s = alvos[+b.dataset.sug];
          if (!s) return;
          if (!$('#f-nome').value.trim()) $('#f-nome').value = s.produto.split(' / ')[0];
          gIrParaProduto(s.produto);
        });
      })
      .catch(e => {
        if (iaJaClassificou()) { el.innerHTML = ''; return; }
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
      const tipo = m.tipo || '';
      let corpo, toque = '';
      if (m.audio) {
        corpo = '<div class="aud">🎤</div><span class="vid">▶ ouvir</span>';
        toque = ` data-ouvir="${m.id}"`;
      } else if (tipo.startsWith('video')) {
        corpo = `<video src="${u}" muted playsinline></video><span class="vid">▶ vídeo</span>`;
      } else if (m.cartao) {
        corpo = `<img src="${u}" alt=""><span class="vid">📇 cartão</span>`;
      } else if (m.placa) {
        corpo = `<img src="${u}" alt=""><span class="vid">📍 placa</span>`;
      } else {
        corpo = `<img src="${u}" alt=""><span class="vid">🔍 tocar</span>`;
        toque = ` data-re="${m.id}" title="tocar para reconhecer de novo"`;
      }
      return `<div class="thumb"${toque}>${corpo}<b data-rm="${m.id}">×</b></div>`;
    }).join('');
    el.querySelectorAll('[data-rm]').forEach(b => b.onclick = (ev) => {
      ev.stopPropagation();
      pendentes = pendentes.filter(x => x.id !== b.dataset.rm);
      renderThumbs();
    });
    // tocar na miniatura reanalisa aquela foto — saída se o reconhecimento
    // não disparou ou se a pessoa quer tentar outra foto do mesmo produto
    el.querySelectorAll('[data-re]').forEach(d => d.onclick = () => {
      const m = pendentes.find(x => x.id === d.dataset.re);
      if (m) reconhecer(m.blob);
    });
    el.querySelectorAll('[data-ouvir]').forEach(d => d.onclick = () => {
      const m = pendentes.find(x => x.id === d.dataset.ouvir);
      if (m) new Audio(blobUrl(m.id, m.blob)).play().catch(() => {});
    });
  }

  /* ---------------- cartão e áudio, lidos pela IA ----------------
     A foto do cartão e o áudio ficam no produto com ou sem internet.
     Com internet, a IA preenche os campos — e a pessoa confere antes
     de salvar. Cada leitura é marcada com a captura em que começou:
     se a pessoa salvar antes de a IA responder, a resposta não cai no
     produto seguinte.                                                */
  let capturaAtual = 0;
  // captura em que a placa do estande foi lida: o número dela vale mais que o do cartão
  let placaLida = -1;

  // a IA devolve número, mas pode vir texto: "1,20" é decimal; "1,000.50", milhar em inglês
  const numero = (v) => {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
    let t = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
    t = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    const n = parseFloat(t);
    return isFinite(n) && n > 0 ? n : 0;
  };
  // peças: "1.000", "1,000" e "1000 pcs" são mil
  const inteiro = (v) => {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? Math.round(v) : 0;
    const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
    return n > 0 ? n : 0;
  };
  const moedaDe = (v) => /cny|rmb|yuan|renminbi|¥|元/i.test(v || '') ? 'CNY'
    : (/usd|us\$|dólar|dolar|\$/i.test(v || '') ? 'USD' : '');

  function camposDoCartao(d) {
    const contato = [
      d.nome && (d.nome + (d.cargo ? ' (' + d.cargo + ')' : '')),
      d.wechat && 'WeChat: ' + d.wechat,
      d.whatsapp && 'WhatsApp: ' + d.whatsapp,
      d.telefone && 'Tel: ' + d.telefone,
      d.email
    ].filter(Boolean).join(' · ');
    const extra = [d.site, d.endereco].filter(Boolean).join(' · ');
    return { forn: (d.empresa || '').trim(), contato, estande: (d.estande || '').trim(),
      obs: extra ? 'Cartão: ' + extra : '' };
  }

  function camposDoAudio(d) {
    return {
      nome: (d.nome || '').trim(),
      desc: (d.descricao || '').trim(),
      preco: numero(d.preco),
      moeda: moedaDe(d.moeda),
      moq: inteiro(d.moq),
      qtd: inteiro(d.quantidade),
      peso: numero(d.peso_kg),
      cbm: numero(d.cbm),
      obs: (d.observacoes || '').trim()
    };
  }

  const juntar = (a, b) => [String(a || '').trim(), b].filter(Boolean).join('\n');

  function avisoIa(titulo, texto) {
    $('#ia-res').innerHTML = `<div class="card tight"><b>${titulo}</b>
      <p class="hint" style="margin:4px 0 0">${texto}</p></div>`;
  }

  /* pode chamar a IA agora? se não, explica por quê */
  const GUARDADO = {
    'Cartão': ['Cartão guardado', 'Ler cartão'],
    'Áudio': ['Áudio guardado', 'Transcrever áudio'],
    'Placa': ['Placa guardada', 'Ler placa']
  };
  function iaDisponivel(oQue) {
    const [guardado, botao] = GUARDADO[oQue];
    if (!SYNC.ativo()) {
      avisoIa(guardado + ' no produto',
        'Para a IA ler, preencha o <b>código da viagem</b> em Config.');
      return false;
    }
    if (!navigator.onLine) {
      avisoIa(guardado + ' no produto',
        'Sem internet agora. Depois, abra o produto e toque em <b>' + botao + '</b>.');
      return false;
    }
    return true;
  }

  function receberCartao(file) {
    if (!file) return;
    comprimir(file).then(b => {
      const m = { id: DB.novoId(), blob: b, tipo: b.type || file.type || 'image/jpeg', nome: file.name, cartao: true };
      pendentes.push(m);
      renderThumbs();
      if (!iaDisponivel('Cartão')) return;
      const minha = capturaAtual;
      avisoIa('Lendo o cartão…', 'pode continuar preenchendo');
      IA.lerCartao(m.blob, SYNC.codigo()).then(d => {
        if (minha !== capturaAtual) return;
        const c = camposDoCartao(d);
        const feito = [];
        // cartão novo é fornecedor novo: troca o que ficou do estande anterior
        if (c.forn) { $('#f-forn').value = c.forn; feito.push('fabricante'); }
        if (c.contato) { $('#f-contato').value = c.contato; feito.push('contato'); }
        // o número impresso no cartão pode ser de outra feira; o da placa é o de agora
        if (c.estande && placaLida !== capturaAtual) { $('#f-estande').value = c.estande; feito.push('estande'); }
        if (c.obs && !$('#f-obs').value.includes(c.obs)) $('#f-obs').value = juntar($('#f-obs').value, c.obs);
        avisoIa(feito.length ? 'Li o cartão' : 'Não achei dados no cartão',
          feito.length ? esc([c.forn, c.contato].filter(Boolean).join(' — ')) +
            '<br>Confira o fabricante e o <b>estande</b> antes de salvar.'
            : 'A foto continua valendo como contato.');
      }).catch(e => {
        if (minha !== capturaAtual) return;
        avisoIa('Cartão guardado, mas não consegui ler', esc(e.message) +
          '. A foto vale como contato; dá para ler depois, no produto.');
      });
    });
  }

  /* ---- gravação ----
     Falar é mais rápido que digitar com o fornecedor na frente.     */
  let gravador = null, gravStream = null, gravPedacos = [], gravInicio = 0, gravTimer = null;

  function pintarBotaoAudio() {
    const b = $('#btn-audio');
    if (!b) return;
    const s = Math.floor((Date.now() - gravInicio) / 1000);
    b.classList.toggle('gravando', !!gravador);
    b.querySelector('.shoot-txt').innerHTML = gravador
      ? `Parar · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}<small>toque para terminar</small>`
      : 'Gravar áudio<small>fale preço e detalhes</small>';
  }

  function alternarGravacao() {
    if (gravador) { gravador.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast('Este celular não grava áudio pelo app');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      gravStream = stream;
      gravPedacos = [];
      // iPhone grava em mp4; Android, em webm. A transcrição aceita os dois.
      const tipo = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        .find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
      gravador = tipo ? new MediaRecorder(stream, { mimeType: tipo }) : new MediaRecorder(stream);
      gravador.ondataavailable = (e) => { if (e.data && e.data.size) gravPedacos.push(e.data); };
      gravador.onstop = () => {
        const blob = new Blob(gravPedacos, { type: (gravador.mimeType || tipo || 'audio/mp4').split(';')[0] });
        gravStream.getTracks().forEach(t => t.stop());
        gravador = null; gravStream = null;
        clearInterval(gravTimer);
        pintarBotaoAudio();
        if (blob.size) receberAudio(blob);
      };
      gravador.start();
      gravInicio = Date.now();
      // 3 minutos bastam para um produto; evita gravar a feira inteira por esquecimento
      gravTimer = setInterval(() => {
        pintarBotaoAudio();
        if (gravador && Date.now() - gravInicio > 180000) gravador.stop();
      }, 500);
      pintarBotaoAudio();
    }).catch(() => toast('Sem acesso ao microfone. Libere nos Ajustes do celular.'));
  }

  function receberAudio(blob) {
    const m = { id: DB.novoId(), blob, tipo: blob.type, nome: 'audio', audio: true };
    pendentes.push(m);
    renderThumbs();
    toast('Áudio guardado');
    if (!iaDisponivel('Áudio')) return;
    const minha = capturaAtual;
    avisoIa('Ouvindo o áudio…', 'pode continuar preenchendo');
    IA.lerAudio(blob, SYNC.codigo()).then(d => {
      if (minha !== capturaAtual) return;
      const c = camposDoAudio(d);
      const feito = [];
      if (c.nome && !$('#f-nome').value.trim()) { $('#f-nome').value = c.nome; feito.push('produto'); }
      if (c.desc) { $('#f-desc').value = juntar($('#f-desc').value, c.desc); feito.push('detalhes'); }
      if (c.preco) { $('#f-preco').value = c.preco; feito.push('preço'); }
      if (c.moeda) $('#f-moeda').value = c.moeda;
      if (c.moq) { $('#f-moq').value = c.moq; feito.push('MOQ'); }
      if (c.qtd) { $('#f-qtd').value = c.qtd; feito.push('quantidade'); }
      if (c.peso) { $('#f-peso').value = c.peso; feito.push('peso'); }
      if (c.cbm) { $('#f-cbm').value = c.cbm; feito.push('CBM'); }
      if (c.obs) { $('#f-obs').value = juntar($('#f-obs').value, c.obs); feito.push('observações'); }
      avisoIa(feito.length ? 'Preenchi pelo áudio: ' + feito.join(', ') : 'Ouvi, mas não achei preço nem detalhes',
        (d.transcricao ? '“' + esc(d.transcricao) + '”<br>' : '') + 'Confira os campos antes de salvar.');
    }).catch(e => {
      if (minha !== capturaAtual) return;
      avisoIa('Áudio guardado, mas não consegui transcrever', esc(e.message) +
        '. Dá para transcrever depois, no produto.');
    });
  }

  /* ---------------- placa do estande ----------------
     A placa no alto do estande traz o número (11.2 K23) e o nome da
     empresa. A foto fica no produto, como a do cartão: sem internet no
     pavilhão, dá para ler depois, no produto.
     Placa de outro estande é fornecedor novo: o que ficou do estande
     anterior sai dos campos, para o WeChat de um não ir parar no
     produto do outro. Se a IA leu errado, um toque desfaz.          */
  const soLetrasNumeros = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // "Huameng" e "CHAOZHOU HUAMENG CERAMICS CO., LTD." são o mesmo fornecedor
  const nomeBase = (s) => (s || '').toLowerCase()
    .replace(/\b(co|ltd|limited|company|corp|inc|factory|group)\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const mesmaEmpresa = (a, b) => {
    const x = nomeBase(a), y = nomeBase(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  };

  function camposDaPlaca(d) {
    return { estande: (d.estande || '').trim(), forn: (d.empresa || '').trim(), obs: (d.observacao || '').trim() };
  }

  // o campo ainda tem o que veio do produto anterior (não foi digitado agora)?
  const herdado = (campo) => {
    const v = $('#f-' + campo).value.trim();
    return !!v && v === ((cfg.ultimoForn || {})[campo] || '').trim();
  };

  const NOME_CAMPO = { forn: 'o fabricante', estande: 'o estande', contato: 'o contato' };

  function aplicarPlaca(c) {
    const campos = ['forn', 'estande', 'contato'];
    const antes = {}, veio = {};
    campos.forEach(k => { antes[k] = $('#f-' + k).value; veio[k] = herdado(k); });
    /* Mudou de estande desde o último produto salvo? É de lá que vem o que
       pode estar velho nos campos. Compara com ele, e não com o campo, que o
       cartão pode ter acabado de preencher com o número de outra feira.
       O número decide; sem número, o nome da empresa. */
    const ult = cfg.ultimoForn || {};
    const outro = c.estande && (ult.estande || '').trim()
      ? soLetrasNumeros(c.estande) !== soLetrasNumeros(ult.estande)
      : !!(c.forn && (ult.forn || '').trim() && !mesmaEmpresa(c.forn, ult.forn));
    if (c.estande) { $('#f-estande').value = c.estande; placaLida = capturaAtual; }
    // o nome digitado agora fica; o que sobrou do estande anterior, não
    if (c.forn && (!antes.forn.trim() || (outro && veio.forn))) $('#f-forn').value = c.forn;
    const apagados = [];
    if (outro) campos.forEach(k => {
      if (!c[k] && veio[k]) { $('#f-' + k).value = ''; apagados.push(NOME_CAMPO[k]); }
    });
    const mudou = campos.some(k => $('#f-' + k).value !== antes[k]);

    const titulo = c.estande ? 'Li a placa: estande ' + esc(c.estande)
      : c.forn ? 'Li a placa, mas não o número do estande' : 'Não achei o número do estande na foto';
    const linhas = c.forn ? [esc(c.forn)] : [];
    if (apagados.length) linhas.push('<b>Outro estande</b>: apaguei ' + apagados.join(' e ') + ' do anterior.'
      + (apagados.includes('o contato') ? ' Tire a foto do cartão ou digite o contato.' : ''));
    else if (!c.estande) linhas.push((c.obs ? esc(c.obs) + '<br>' : '') + 'Digite o número, ou tire outra foto mais de perto.');
    else if (outro) linhas.push('<b>Outro estande</b>: confira o fabricante e o contato.');
    else if ((ult.estande || '').trim()) linhas.push('Mesmo estande do produto anterior.');
    else if (antes.forn.trim() || antes.contato.trim()) linhas.push('Confira se o fabricante e o contato são deste estande.');
    else linhas.push('Confira o número antes de salvar.');
    avisoIa(titulo, linhas.join('<br>') + (mudou ? ' <button type="button" class="link" id="ia-desfazer">↩ desfazer</button>' : ''));
    if (mudou) $('#ia-desfazer').onclick = () => {
      campos.forEach(k => $('#f-' + k).value = antes[k]);
      placaLida = -1;
      avisoIa('Voltei o que estava antes', 'A foto da placa continua no produto.');
    };
  }

  function receberPlaca(file) {
    if (!file) return;
    comprimir(file).then(b => {
      const m = { id: DB.novoId(), blob: b, tipo: b.type || file.type || 'image/jpeg', nome: file.name, placa: true };
      pendentes.push(m);
      renderThumbs();
      if (!iaDisponivel('Placa')) return;
      const minha = capturaAtual;
      avisoIa('Lendo a placa…', 'pode continuar preenchendo');
      IA.lerEstande(m.blob, SYNC.codigo()).then(d => {
        if (minha !== capturaAtual) return;
        aplicarPlaca(camposDaPlaca(d));
      }).catch(e => {
        if (minha !== capturaAtual) return;
        avisoIa('Placa guardada, mas não consegui ler', esc(e.message) +
          '. Digite o número do estande, ou leia depois, no produto.');
      });
    });
  }

  /* ---------------- NCM pela IA ----------------
     O reconhecimento no aparelho conhece mil objetos genéricos e o
     dicionário do modo Guiado é de utilidades: banheira, vaso sanitário,
     sauna, casa pré-fabricada e painel de PVC — o que esta feira vende —
     saíam todos "Não reconheci". Com internet, a IA olha a foto e diz a
     posição (4 dígitos); o item final sai da tabela oficial que está no
     aparelho, escolhido pelos textos dela. Inventando de cabeça, a IA erra
     o fim do código: pôs um toalheiro em 8516.79.10, que é "Panelas".
     Sugere, nunca decide: quem toca escolhe.                          */
  let ncmCaptura = null;        // NCM escolhida na captura: vai junto ao salvar
  let ncmIaFeita = -1;          // captura em que a classificação automática já rodou
  let ncmIaMostrada = -1;       // e em que ela já respondeu

  /* os dois últimos níveis da hierarquia, cortados pelo começo: é no fim
     do texto da posição que está o material ("…de cerâmica", "…de plástico") */
  const niveisDoItem = (it) => (it.path || '').split(' > ').filter(Boolean).slice(-2)
    .map(t => t.length > 90 ? '…' + t.slice(-90).replace(/^\S*\s/, '') : t);
  // com o texto do item: é o que separa os itens de uma posição
  const textoDoItem = (it) => niveisDoItem(it).concat(it.desc).join(' > ');

  /* um grupo por posição sugerida, com todos os itens oficiais dela.
     Posição que não existe na tabela é palpite descartado. */
  function gruposDaIa(candidatos) {
    const grupos = [];
    (candidatos || []).forEach(c => {
      const pos = String(c.ncm || '').replace(/\D/g, '').slice(0, 4);
      if (pos.length < 4 || grupos.some(g => g.pos === pos)) return;
      const itens = BASE.itensPorPrefixo(pos);
      if (itens.length) grupos.push({ pos, itens, ncm: String(c.ncm), motivo: c.motivo || '', confirmar: c.confirmar || '' });
    });
    return grupos;
  }

  /* devolve { produto, descricao, observacao, opcoes: [{ item, motivo, confirmar }] } */
  function classificarComIa(imagem, texto) {
    const viagem = SYNC.codigo();
    return IA.classificarNcm(imagem, texto, viagem).then(r => {
      const grupos = gruposDaIa(r.candidatos);
      const varios = grupos.filter(g => g.itens.length > 1);
      const etapa2 = !varios.length ? Promise.resolve([])
        : IA.escolherItemNcm({
          produto: r.produto, descricao: r.descricao, texto,
          grupos: varios.map(g => ({ sub: g.pos, motivo: g.motivo,
            itens: g.itens.slice(0, 80).map(it => ({ ncm: it.ncm, desc: textoDoItem(it) })) }))
        }, viagem).then(e => e.escolhas || []).catch(() => null);
      return etapa2.then(escolhas => {
        const opcoes = [];
        grupos.forEach(g => {
          let item = null, motivo = g.motivo;
          if (g.itens.length === 1) item = g.itens[0];
          else if (escolhas) {
            const e = escolhas.find(x => g.itens.some(it => it.ncm === x.ncm));
            if (e) { item = g.itens.find(it => it.ncm === e.ncm); motivo = e.motivo || motivo; }
          } else {
            // a 2ª etapa não respondeu: o código da 1ª só vale se existir na tabela
            item = BASE.item(g.ncm.replace(/\D/g, '').slice(0, 8));
          }
          if (item && !opcoes.some(o => o.item.ncm === item.ncm)) opcoes.push({ item, motivo, confirmar: g.confirmar });
        });
        return { produto: r.produto || '', descricao: r.descricao || '', observacao: r.observacao || '', opcoes };
      });
    });
  }

  function htmlOpcoesNcm(res, dado, cond) {
    return `<div class="opcoes">` + res.opcoes.map((o, i) => {
      const it = o.item;
      const r = BASE.risco(it.ncm, { cond, texto: res.produto + ' ' + res.descricao });
      return `<button type="button" data-${dado}="${i}"><span><span class="code">${fmtNcm(it.ncm)}</span> · ${esc(it.desc)}
          <small>${esc(niveisDoItem(it).join(' > '))}</small>
          ${o.motivo || o.confirmar ? `<small>${esc(o.motivo)}${o.confirmar ? ' · <b>confirme:</b> ' + esc(o.confirmar) : ''}</small>` : ''}
          <small><span class="tag tag-ac">II ${typeof it.ii === 'number' ? it.ii + '%' : '?'}</span>
            <span class="tag">IPI ${it.ipi === 'NT' ? 'NT' : (typeof it.ipi === 'number' ? it.ipi + '%' : '?')}</span>
            <span class="tag ${NIVEL_TAG[r.nivel]}">${esc(r.rotulo)}</span></small></span>
        <span class="seta">›</span></button>`;
    }).join('') + `</div>`;
  }

  const anotacoes = (pares) => pares.filter(([, v]) => (v || '').trim())
    .map(([k, v]) => k + ': ' + v.trim()).join('. ');

  function pintarNcmCaptura(res) {
    const el = $('#ncm-ia');
    if (ncmCaptura) {
      el.innerHTML = `<div class="card tight"><b>🤖 NCM ${fmtNcm(ncmCaptura.ncm)} escolhida</b>
        <p class="hint" style="margin:4px 0 0">${esc(ncmCaptura.ncmDesc)} — vai junto quando você salvar.
        <button type="button" class="link" id="ncm-trocar">trocar</button></p></div>`;
      $('#ncm-trocar').onclick = () => { ncmCaptura = null; pintarNcmCaptura(res); };
      return;
    }
    el.innerHTML = `<div class="card">
      <h3 style="margin-bottom:4px">🤖 ${res.opcoes.length ? 'NCM sugerida pela IA' : 'A IA não achou a NCM'}</h3>
      <p class="hint" style="margin:0 0 10px">${esc([res.produto, res.observacao].filter(Boolean).join(' · ')
        || 'A foto não mostrou o produto com clareza.')}</p>
      ${res.opcoes.length ? htmlOpcoesNcm(res, 'ncm-op', condAtual) + `<p class="hint">Toque na certa: ela vai junto
        quando você salvar. Confira o texto oficial e o que pedir ao fornecedor.</p>` : ''}
      <button type="button" class="ghost" id="ncm-de-novo">🤖 Classificar de novo com o que escrevi</button></div>`;
    el.querySelectorAll('[data-ncm-op]').forEach(b => b.onclick = () => {
      const it = res.opcoes[+b.dataset.ncmOp].item;
      ncmCaptura = { ncm: it.ncm, ncmDesc: it.desc, ii: it.ii, ipi: it.ipi };
      pintarNcmCaptura(res);
      toast('NCM ' + fmtNcm(it.ncm) + ' vai junto ao salvar');
    });
    $('#ncm-de-novo').onclick = deNovo;
  }
  // a foto desta captura (a que a pessoa tirou × some daqui), ou só o texto
  const deNovo = () => classificarCaptura((pendentes.find(fotoDoProduto) || {}).blob);

  function classificarCaptura(foto) {
    const el = $('#ncm-ia');
    if (!SYNC.ativo() || !navigator.onLine) {
      el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">🤖 NCM pela IA: ${!SYNC.ativo()
        ? 'preencha o <b>código da viagem</b> em Config.'
        : 'sem internet agora. Depois de salvar, abra o produto e toque em <b>Classificar NCM com IA</b>.'}</p></div>`;
      return;
    }
    const minha = capturaAtual;
    ncmIaFeita = minha;
    const texto = anotacoes([['Produto', $('#f-nome').value], ['Detalhes', $('#f-desc').value], ['Observações', $('#f-obs').value]]);
    el.innerHTML = `<div class="card tight"><p class="hint" style="margin:0">🤖 a IA está classificando a NCM…</p></div>`;
    (foto ? imagemReduzida(foto, 800, 0.7) : Promise.resolve(null))
      .then(img => {
        if (!img && !texto) throw new Error('tire a foto ou escreva o nome do produto');
        return classificarComIa(img, texto);
      })
      .then(res => {
        if (minha !== capturaAtual) return;
        ncmIaMostrada = minha;
        // o nome e os detalhes que a IA viu poupam digitação; o que já foi escrito fica
        if (res.produto && !$('#f-nome').value.trim()) $('#f-nome').value = res.produto;
        if (res.descricao && !$('#f-desc').value.trim()) $('#f-desc').value = res.descricao;
        if (res.opcoes.length) $('#sugestao').innerHTML = '';   // o palpite do aparelho sai: a IA viu melhor
        ncmCaptura = null;
        pintarNcmCaptura(res);
        // quem está digitando não perde o lugar
        if (!/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || ''))
          try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
      })
      .catch(e => {
        if (minha !== capturaAtual) return;
        el.innerHTML = `<div class="card tight"><b>🤖 Não consegui classificar</b>
          <p class="hint" style="margin:4px 0 10px">${esc(e.message)}. Dá para tentar de novo agora ou depois, no produto.</p>
          <button type="button" class="ghost" id="ncm-de-novo">🤖 Classificar de novo com o que escrevi</button></div>`;
        $('#ncm-de-novo').onclick = deNovo;
      });
  }
  // a IA já respondeu com opções nesta captura: o palpite do aparelho não volta por cima
  const iaJaClassificou = () => ncmIaMostrada === capturaAtual && !!$('#ncm-ia [data-ncm-op], #ncm-ia #ncm-trocar');

  /* Versão nova baixada no meio da feira: recarregar com foto ou preço
     ainda não salvos jogaria o cadastro fora. Espera o formulário ficar
     vazio, depois de salvar. Nunca ao ir para segundo plano: abrir a
     câmera também esconde a página, e a foto voltaria para um app
     recarregado. Se não der antes, a versão nova entra ao reabrir.  */
  let versaoNova = false;
  function capturaEmAndamento() {
    return pendentes.length > 0 ||
      ['f-nome', 'f-desc', 'f-preco', 'f-obs'].some(id => $('#' + id).value.trim());
  }
  function recarregarSePuder() {
    if (!versaoNova) return;
    if (capturaEmAndamento()) {
      toast('Versão nova pronta · entra quando você salvar este produto');
      return;
    }
    versaoNova = false;
    toast('Versão nova baixada · recarregando…');
    setTimeout(() => location.reload(), 2200);
  }

  function limparForm() {
    ['f-nome', 'f-desc', 'f-preco', 'f-moq', 'f-qtd', 'f-peso', 'f-cbm', 'f-obs'].forEach(id => $('#' + id).value = '');
    pendentes = []; renderThumbs();
    notaCaptura = 0;
    document.querySelectorAll('#f-nota button').forEach(b => b.classList.remove('on'));
    document.querySelector('#sugestao').innerHTML = '';
    document.querySelector('#ia-res').innerHTML = '';
    document.querySelector('#ncm-ia').innerHTML = '';
    document.querySelector('#cap-erro').innerHTML = '';
    ncmCaptura = null;
    capturaAtual++;
    // fornecedor/estande/contato ficam: normalmente são vários produtos do mesmo estande
    recarregarSePuder();
  }

  function salvarProduto() {
    const nome = $('#f-nome').value.trim();
    const forn = $('#f-forn').value.trim();
    const temCartao = pendentes.some(m => m.cartao);
    const contato = $('#f-contato').value.trim() || (temCartao ? 'na foto do cartão' : '');
    const erro = $('#cap-erro');
    const faltou = [];
    if (!notaCaptura) faltou.push('nota');
    if (!nome) faltou.push('produto');
    if (!forn) faltou.push('fabricante');
    if (!contato) faltou.push('contato');
    if (faltou.length) {
      erro.innerHTML = `<div class="alerta bad" style="margin-bottom:10px">
        <b>Faltou preencher: ${faltou.join(', ')}</b>
        O contato do fabricante é o que você não consegue recuperar depois —
        sem ele a foto não vale nada. Uma foto do cartão também vale.</div>`;
      try { erro.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
      return;
    }
    erro.innerHTML = '';
    const id = DB.novoId();
    const p = {
      id, nome, nota: notaCaptura,
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
      contato,
      cond: condAtual,
      obs: $('#f-obs').value.trim(),
      ncm: null, ncmDesc: '', ii: null, ipi: null,
      criado: Date.now(), atualizado: Date.now()
    };
    if (ncmCaptura) Object.assign(p, ncmCaptura, { ncmIa: true });
    const midias = pendentes.map(m => ({ id: m.id, produtoId: id, blob: m.blob, tipo: m.tipo, nome: m.nome,
      cartao: !!m.cartao, audio: !!m.audio, placa: !!m.placa }));
    miniaturaDe(midias)
      .then(mini => { if (mini) p.miniatura = mini; return DB.salvarProduto(p); })
      .then(() => Promise.all(midias.map(m => DB.salvarMidia(m))))
      .then(() => {
        produtos.push(p);
        // guarda o estande para o próximo produto do mesmo fornecedor
        cfg.ultimoForn = { forn: p.forn, contato: p.contato, estande: p.estande, fase: p.fase };
        DB.setCfg('ultimoForn', cfg.ultimoForn);
        limparForm(); atualizaContador();
        toast('Salvo: ' + p.nome);
        agendarSync();
      })
      .catch(e => {
        $('#cap-erro').innerHTML = `<div class="alerta bad" style="margin-bottom:10px">
          <b>Não consegui salvar</b>${esc(e.message || e)}<br>
          Se você está no Safari em aba privada, saia dela: o armazenamento fica bloqueado.</div>`;
      });
  }

  function atualizaContador() {
    const n = produtos.length;
    let txt = n + (n === 1 ? ' produto' : ' produtos');
    const pill = $('#count-pill');
    pill.className = 'pill';
    if (SYNC.ativo()) {
      const pend = pendentes_();
      // mostra a verdade no topo: o que já subiu e o que ainda não
      if (pend > 0) { txt += ' · ' + pend + '↑'; pill.className = 'pill pill-off'; }
      else { txt += ' · ✓'; pill.className = 'pill pill-on'; }
    } else {
      // sem código, nada sai do aparelho — e até a v19 isso não aparecia em lugar nenhum
      txt += ' · sem sync'; pill.className = 'pill pill-off';
    }
    pill.textContent = txt;
  }

  /* ---------------- lista de produtos ---------------- */
  function nomeCat(id) {
    if (!PRODUTOS || !id) return '';
    const c = PRODUTOS.categorias.find(x => x.id === id);
    return c ? c.nome : '';
  }
  function icoCat(id) {
    if (!PRODUTOS || !id) return '';
    const c = PRODUTOS.categorias.find(x => x.id === id);
    return c ? c.ico : '';
  }

  function renderFiltros() {
    // só mostra categoria que existe entre os produtos capturados
    const usadas = Array.from(new Set(produtos.map(p => p.cat).filter(Boolean)));
    const elc = $('#p-cats');
    elc.innerHTML = usadas.length
      ? `<span class="chip${filtroCat ? '' : ' on'}" data-cat="">Todas</span>`
        + usadas.map(id => {
          const n = produtos.filter(p => p.cat === id).length;
          return `<span class="chip${filtroCat === id ? ' on' : ''}" data-cat="${id}">${icoCat(id)} ${esc(nomeCat(id))} ${n}</span>`;
        }).join('')
      : '';
    elc.querySelectorAll('[data-cat]').forEach(c => c.onclick = () => {
      filtroCat = c.dataset.cat; renderProdutos();
    });

    const els = $('#p-status');
    const usados = STATUS.filter(s => produtos.some(p => (p.status || 'novo') === s.id));
    const nFav = produtos.filter(p => p.fav).length;
    const chipFav = nFav
      ? `<span class="chip${filtroStatus === '__fav' ? ' on' : ''}" data-st="__fav">★ Favoritos ${nFav}</span>` : '';
    els.innerHTML = (usados.length > 1 || nFav)
      ? `<span class="chip${filtroStatus ? '' : ' on'}" data-st="">Todas situações</span>`
        + chipFav
        + usados.map(s => {
          const n = produtos.filter(p => (p.status || 'novo') === s.id).length;
          return `<span class="chip${filtroStatus === s.id ? ' on' : ''}" data-st="${s.id}">${esc(s.nome)} ${n}</span>`;
        }).join('')
      : '';
    els.querySelectorAll('[data-st]').forEach(c => c.onclick = () => {
      filtroStatus = c.dataset.st; renderProdutos();
    });
  }

  function renderProdutos() {
    renderFiltros();
    const q = BASE.norm($('#p-filtro').value);
    let lista = produtos.slice();
    if (filtroCat) lista = lista.filter(p => p.cat === filtroCat);
    if (filtroStatus === '__fav') lista = lista.filter(p => p.fav);
    else if (filtroStatus) lista = lista.filter(p => (p.status || 'novo') === filtroStatus);
    if (q) {
      lista = lista.filter(p => BASE.norm([p.nome, p.desc, p.forn, p.estande, p.ncm, p.obs,
        (p.notas || []).map(n => n.txt).join(' ')].join(' ')).includes(q));
    }
    const riscoDe = (p) => p.ncm ? ({ ok: 0, warn: 1, mid: 2, bad: 3 })[BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }).nivel] : -1;
    if (ordem === 'data') lista.sort((a, b) => b.criado - a.criado);
    if (ordem === 'risco') lista.sort((a, b) => riscoDe(b) - riscoDe(a) || b.criado - a.criado);
    if (ordem === 'nota') lista.sort((a, b) => (b.nota || 0) - (a.nota || 0) || b.criado - a.criado);

    // resumo do que está filtrado: o número que interessa no fim do dia
    const res = $('#p-resumo');
    const aviso = SYNC.ativo() ? '' : `<div class="alerta warn" style="margin-bottom:10px">
      <b>Estes produtos estão só neste celular</b>
      Para ver os produtos dos outros celulares — e eles os seus — preencha o mesmo
      <b>código da viagem</b> nos três.
      <button class="ghost" data-ir-sync style="margin-top:8px">Preencher agora</button></div>`;
    if (lista.length) {
      const comNcm = lista.filter(p => p.ncm).length;
      const revisar = lista.filter(p => p.paraRevisar).length;
      const risco = lista.filter(p => p.ncm && BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }).nivel === 'bad').length;
      res.innerHTML = `<div class="card tight" style="margin-bottom:10px">
        <div class="it-foot" style="margin:0">
          <span class="tag">${lista.length} produto${lista.length > 1 ? 's' : ''}</span>
          <span class="tag ${comNcm === lista.length ? 'tag-ok' : 'tag-warn'}">${comNcm} classificado${comNcm !== 1 ? 's' : ''}</span>
          ${risco ? `<span class="tag tag-bad">${risco} com risco sério</span>` : ''}
          ${revisar ? `<span class="tag tag-bad">${revisar} para o Leonardo</span>` : ''}
        </div></div>`;
    } else res.innerHTML = '';
    res.insertAdjacentHTML('afterbegin', aviso);
    const irSync = res.querySelector('[data-ir-sync]');
    if (irSync) irSync.onclick = abrirSync;

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
      const foto = ms.find(fotoDoProduto) || ms.find(m => (m.tipo || '').startsWith('image'));
      // produto de outro celular não tem a foto aqui: vem a miniatura
      if (!img) return;
      semFoto(img, p);
      if (foto) img.src = blobUrl(foto.id, foto.blob);
      else if (p.miniatura) img.src = p.miniatura;
      else img.classList.add('sem-foto');
    }));
    el.querySelectorAll('[data-abrir]').forEach(c => c.onclick = () => abrirProduto(c.dataset.abrir));
    // a estrela não abre o produto: favoritar tem que ser um toque só
    el.querySelectorAll('[data-fav]').forEach(s => s.onclick = (ev) => {
      ev.stopPropagation();
      const p = produtos.find(x => x.id === s.dataset.fav);
      if (!p) return;
      p.fav = !p.fav;
      p.atualizado = Date.now();
      DB.salvarProduto(p).then(() => { toast(p.fav ? "★ Favoritado" : "Removido dos favoritos"); renderProdutos(); agendarSync(); });
    });
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
      if (p.ncmIa) tags.push('<span class="tag">🤖 IA</span>');
      tags.push(`<span class="tag ${NIVEL_TAG[r.nivel]}">${esc(r.rotulo)}</span>`);
      r.orgaos.slice(0, 3).forEach(o => tags.push(`<span class="tag">${esc(o)}</span>`));
    } else if (p.paraRevisar) {
      tags.push('<span class="tag tag-bad">↑ Leonardo precisa classificar</span>');
    } else {
      tags.push('<span class="tag tag-warn">sem NCM — classificar</span>');
    }
    if (p.cond === 'usado') tags.push('<span class="tag tag-bad">usado</span>');
    const st = statusDe(p.status);
    if (st.id !== 'novo') tags.unshift(`<span class="tag ${st.tag}">${esc(st.nome)}</span>`);
    if (!ehMeu(p)) tags.unshift(`<span class="tag tag-ac">de ${esc(nomeAutor(p))}</span>`);
    const nNotas = (p.notas || []).length;
    if (nNotas) tags.push(`<span class="tag">${nNotas} nota${nNotas > 1 ? 's' : ''}</span>`);
    const sub = [p.cat ? icoCat(p.cat) + ' ' + nomeCat(p.cat) : '', p.forn, p.estande && 'estande ' + p.estande,
      p.preco ? `${p.moeda} ${n2(p.preco)}` : '', p.moq ? `MOQ ${p.moq}` : '']
      .filter(Boolean).join(' · ');
    return `<div class="it" data-abrir="${p.id}">
      <div class="it-top">
        <img class="it-pic" data-pic="${p.id}" alt="">
        <div class="it-b">
          <div class="it-nome">${esc(p.nome)}</div>
          <div class="it-sub">${esc(sub) || '—'}</div>
        </div>
        <div style="text-align:right">
          ${p.nota ? `<div class="nota-sel ${p.nota >= 8 ? 'alta' : (p.nota <= 4 ? 'baixa' : '')}">${p.nota}</div>` : ''}
          <span class="fav${p.fav ? ' on' : ''}" data-fav="${p.id}" title="favoritar">${p.fav ? '★' : '☆'}</span>
          ${cu ? `<div class="sc" style="justify-content:flex-end"><b>${brl(cu)}</b><span>/un</span></div>` : ''}
        </div>
      </div>
      <div class="it-foot">${tags.join('')}</div>
    </div>`;
  }

  /* ---------------- detalhe do produto ---------------- */
  function abrirProduto(id) {
    const p = produtos.find(x => x.id === id);
    if (!p) return;
    DB.midiasDe(id).then(ms => {
      const audios = ms.filter(m => m.audio);
      const cartoes = ms.filter(m => m.cartao);
      const placas = ms.filter(m => m.placa);
      let fotos = ms.filter(m => !m.audio && !m.cartao && !m.placa).map(m => {
        const u = blobUrl(m.id, m.blob);
        return (m.tipo || '').startsWith('video')
          ? `<div class="thumb"><video src="${u}" controls playsinline></video></div>`
          : `<div class="thumb"><img src="${u}" alt=""></div>`;
      }).join('');
      if (!fotos && p.miniatura) fotos = `<div class="thumb"><img src="${esc(p.miniatura)}" alt=""></div>`;
      // a placa vai junto das fotos, pequena: dela só se precisa do número
      fotos += placas.map(m => `<div class="thumb"><img src="${blobUrl(m.id, m.blob)}" alt="placa" data-placa="1">
        <span class="vid">📍 placa</span></div>`).join('');
      // o cartão em tamanho de leitura: é dele que sai o WeChat
      const cartaoHtml = cartoes.map(m => `<img class="cartao-img" src="${blobUrl(m.id, m.blob)}" alt="cartão">`).join('');
      const sons = audios.map(m => `<audio controls preload="none" src="${blobUrl(m.id, m.blob)}"></audio>`).join('');
      const r = p.ncm ? BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }) : null;
      modal(`
        <h1 style="font-size:18px;margin-bottom:4px">${esc(p.nome)}</h1>
        <p class="hint" style="margin:0 0 12px">${esc([p.forn, p.estande && 'estande ' + p.estande, 'Fase ' + p.fase,
          !ehMeu(p) && 'cadastrado por ' + nomeAutor(p)].filter(Boolean).join(' · '))}</p>
        ${fotos ? `<div class="thumbs">${fotos}</div>` : ''}
        ${cartaoHtml}
        ${sons ? `<div class="sons">${sons}</div>` : ''}
        ${cartoes.length || placas.length || audios.length ? `<div style="margin:0 0 10px">
          ${cartoes.length ? '<button class="ghost" id="m-ler-cartao">📇 Ler cartão com a IA</button>' : ''}
          ${placas.length ? '<button class="ghost" id="m-ler-placa">📍 Ler placa com a IA</button>' : ''}
          ${audios.length ? '<button class="ghost" id="m-ler-audio">🎤 Transcrever áudio com a IA</button>' : ''}
        </div>` : ''}
        ${p.desc ? `<p style="font-size:13.5px;color:var(--dim)">${esc(p.desc)}</p>` : ''}
        <table class="br" style="margin:10px 0">
          ${linhaInfo('Preço FOB', p.preco ? `${p.moeda} ${n2(p.preco)}` : '—')}
          ${linhaInfo('MOQ / quantidade', `${p.moq || '—'} / ${p.qtd || '—'}`)}
          ${linhaInfo('Peso / CBM unit.', `${p.peso || '—'} kg / ${p.cbm || '—'} m³`)}
          ${linhaInfo('Contato', p.contato || '—')}
          ${linhaInfo('Condição', p.cond === 'usado' ? 'usado / recondicionado' : 'novo')}
          ${p.obs ? linhaInfo('Observações', p.obs) : ''}
        </table>
        <div class="card" style="margin:12px 0 0">
          <h3 style="margin-bottom:9px">Nota de 1 a 10</h3>
          <div class="notas" id="m-nota">
            ${[1,2,3,4,5,6,7,8,9,10].map(n =>
              `<button type="button" data-nota="${n}" class="${p.nota === n ? 'on' : ''}">${n}</button>`).join('')}
          </div>
          <h3 style="margin:14px 0 9px">Situação</h3>
          <label class="chk" style="margin:0 0 12px"><input type="checkbox" id="m-fav"> Marcar como favorito</label>
          <div class="chips" id="m-status">
            ${STATUS.map(s => `<span class="chip${statusDe(p.status).id === s.id ? ' on' : ''}" data-st="${s.id}">${esc(s.nome)}</span>`).join('')}
          </div>
          <div class="f" style="margin-top:12px">
            <label for="m-cat">Categoria</label>
            <select id="m-cat">
              <option value="">— sem categoria —</option>
              ${(PRODUTOS ? PRODUTOS.categorias : []).map(c =>
                `<option value="${c.id}"${p.cat === c.id ? ' selected' : ''}>${c.ico} ${esc(c.nome)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="card" style="margin:12px 0 0">
          <h3 style="margin-bottom:9px">Anotações</h3>
          <div id="m-notas">${renderNotas(p)}</div>
          <textarea id="m-nota-txt" rows="2" placeholder="o que aconteceu: preço que ele aceitou, prazo, amostra, concorrente…"></textarea>
          <button class="ghost" id="m-add-nota" style="margin-top:8px">Adicionar anotação</button>
        </div>

        ${r ? blocoRisco(r) : '<p class="warn">Sem NCM atribuída. Classifique para ver barreiras e custo.</p>'}
        ${r && p.ncmIa ? '<p class="hint">🤖 NCM sugerida pela IA e escolhida no app — confira o texto oficial antes de fechar o pedido.</p>' : ''}
        <div id="m-ncm-ia-res"></div>
        <div style="margin-top:14px">
          <button class="ghost" id="m-ncm-ia">🤖 ${p.ncm ? 'Conferir a NCM com a IA' : 'Classificar NCM com IA'}</button>
          <button class="ghost" id="m-classificar">${p.ncm ? 'Trocar a NCM' : 'Classificar NCM'}</button>
          ${p.ncm ? '<button class="ghost" id="m-custo">Ver previsão de custo</button>' : ''}
          <button class="ghost danger" id="m-apagar">Apagar produto</button>
        </div>`);
      /* ---- situação, categoria e notas ---- */
      // placa que não abre não vira a miniatura do produto
      $('#modal-body').querySelectorAll('.thumbs img').forEach(i => semFoto(i, i.dataset.placa ? null : p));
      const salvar = () => { p.atualizado = Date.now(); agendarSync(); return DB.salvarProduto(p); };
      /* ---- leitura que ficou para depois (sem internet no pavilhão) ---- */
      const podeLer = () => {
        if (!SYNC.ativo()) { toast('Preencha o código da viagem em Config'); return false; }
        if (!navigator.onLine) { toast('Sem internet agora'); return false; }
        return true;
      };
      const releu = (msg) => salvar().then(() => { toast(msg); renderProdutos(); abrirProduto(p.id); });
      if ($('#m-ler-cartao')) $('#m-ler-cartao').onclick = () => {
        if (!podeLer()) return;
        toast('Lendo o cartão…');
        IA.lerCartao(cartoes[cartoes.length - 1].blob, SYNC.codigo()).then(d => {
          const c = camposDoCartao(d);
          if (c.forn) p.forn = c.forn;
          if (c.contato) p.contato = c.contato;
          if (c.estande && !p.estande) p.estande = c.estande;
          if (c.obs && !(p.obs || '').includes(c.obs)) p.obs = juntar(p.obs, c.obs);
          return releu(c.forn || c.contato ? 'Cartão lido' : 'Não achei dados no cartão');
        }).catch(e => toast('Não li o cartão: ' + e.message));
      };
      if ($('#m-ler-placa')) $('#m-ler-placa').onclick = () => {
        if (!podeLer()) return;
        toast('Lendo a placa…');
        IA.lerEstande(placas[placas.length - 1].blob, SYNC.codigo()).then(d => {
          const c = camposDaPlaca(d);
          if (!c.estande) { toast('Não achei o número do estande na foto'); return; }
          p.estande = c.estande;
          // o fabricante salvo fica; nome diferente na placa vai para as observações
          if (c.forn && !mesmaEmpresa(c.forn, p.forn) && !(p.obs || '').includes(c.forn)) p.obs = juntar(p.obs, 'Placa: ' + c.forn);
          return releu('Estande ' + c.estande);
        }).catch(e => toast('Não li a placa: ' + e.message));
      };
      /* NCM pela IA: com a foto do aparelho ou, no produto de outro
         celular, com a miniatura que veio na sincronização */
      $('#m-ncm-ia').onclick = () => {
        if (!podeLer()) return;
        const alvo = $('#m-ncm-ia-res');
        alvo.innerHTML = '<p class="hint">🤖 a IA está classificando a NCM…</p>';
        const foto = ms.find(fotoDoProduto);
        const texto = anotacoes([['Produto', p.nome], ['Detalhes', p.desc], ['Observações', p.obs]]);
        (foto ? imagemReduzida(foto.blob, 800, 0.7) : Promise.resolve(p.miniatura || null))
          .then(img => classificarComIa(img, texto))
          .then(res => {
            if (!res.opcoes.length) {
              alvo.innerHTML = `<p class="hint">🤖 A IA não achou a NCM${res.observacao ? ': ' + esc(res.observacao) : ''}.
                Escreva os detalhes numa anotação ou use <b>Classificar NCM</b>.</p>`;
              return;
            }
            alvo.innerHTML = `<h3 style="margin:14px 0 8px">🤖 NCM sugerida pela IA</h3>
              <p class="hint" style="margin:0 0 10px">${esc([res.produto, res.observacao].filter(Boolean).join(' · '))}</p>
              ${htmlOpcoesNcm(res, 'm-ncm-op', p.cond)}
              <p class="hint">Toque na certa para gravar no produto. Confira o texto oficial e o que pedir ao fornecedor.</p>`;
            alvo.querySelectorAll('[data-m-ncm-op]').forEach(b => b.onclick = () => {
              const it = res.opcoes[+b.dataset.mNcmOp].item;
              Object.assign(p, { ncm: it.ncm, ncmDesc: it.desc, ii: it.ii, ipi: it.ipi, ncmIa: true });
              if (p.paraRevisar) p.paraRevisar = false;
              releu('NCM ' + fmtNcm(it.ncm) + ' gravada');
            });
            try { alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
          })
          .catch(e => { alvo.innerHTML = `<p class="hint">🤖 Não consegui classificar: ${esc(e.message)}.</p>`; });
      };
      if ($('#m-ler-audio')) $('#m-ler-audio').onclick = () => {
        if (!podeLer()) return;
        toast('Ouvindo o áudio…');
        IA.lerAudio(audios[audios.length - 1].blob, SYNC.codigo()).then(d => {
          const c = camposDoAudio(d);
          if (c.nome && !p.nome) p.nome = c.nome;
          if (c.desc && !(p.desc || '').includes(c.desc)) p.desc = juntar(p.desc, c.desc);
          if (c.preco) p.preco = c.preco;
          if (c.moeda) p.moeda = c.moeda;
          if (c.moq) p.moq = c.moq;
          if (c.qtd) p.qtd = c.qtd;
          if (c.peso) p.peso = c.peso;
          if (c.cbm) p.cbm = c.cbm;
          if (c.obs && !(p.obs || '').includes(c.obs)) p.obs = juntar(p.obs, c.obs);
          return releu('Áudio transcrito');
        }).catch(e => toast('Não transcrevi: ' + e.message));
      };
      $('#modal-body').querySelectorAll('#m-status [data-st]').forEach(c => c.onclick = () => {
        p.status = c.dataset.st;
        $('#modal-body').querySelectorAll('#m-status [data-st]')
          .forEach(x => x.classList.toggle('on', x.dataset.st === p.status));
        salvar().then(() => { toast('Situação: ' + statusDe(p.status).nome); renderProdutos(); });
      });
      $('#modal-body').querySelectorAll('#m-nota button').forEach(b => b.onclick = () => {
        p.nota = +b.dataset.nota;
        $('#modal-body').querySelectorAll('#m-nota button')
          .forEach(x => x.classList.toggle('on', +x.dataset.nota === p.nota));
        salvar().then(() => { toast('Nota ' + p.nota); renderProdutos(); });
      });
      $('#m-fav').checked = !!p.fav;
      $('#m-fav').onchange = () => {
        p.fav = $('#m-fav').checked;
        salvar().then(() => { toast(p.fav ? '★ Favoritado' : 'Removido dos favoritos'); renderProdutos(); });
      };
      $('#m-cat').onchange = () => { p.cat = $('#m-cat').value; salvar().then(renderProdutos); };
      $('#m-add-nota').onclick = () => {
        const txt = $('#m-nota-txt').value.trim();
        if (!txt) return;
        p.notas = p.notas || [];
        p.notas.push({ t: Date.now(), txt });
        $('#m-nota-txt').value = '';
        salvar().then(() => {
          $('#m-notas').innerHTML = renderNotas(p);
          ligarApagarNota(p);
          toast('Anotação salva');
          renderProdutos();
        });
      };
      ligarApagarNota(p);

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
      /* Apagar o que eu cadastrei some dos três celulares. O que outro
         celular cadastrou só sai deste: ninguém perde a captura do outro
         por um toque errado. Nos dois casos fica a marca, para a próxima
         sincronização não trazer o produto de volta.                   */
      $('#m-apagar').onclick = () => {
        const meu = ehMeu(p);
        if (!confirm(meu
          ? 'Apagar "' + p.nome + '" e suas fotos? Some também dos outros celulares.'
          : 'Tirar "' + p.nome + '" deste celular? Ele continua no celular de ' + nomeAutor(p) + '.')) return;
        cfg.apagados = Object.assign({}, cfg.apagados, { [p.id]: { t: Date.now(), meu } });
        DB.setCfg('apagados', cfg.apagados);
        DB.apagarProduto(p.id).then(() => {
          produtos = produtos.filter(x => x.id !== p.id);
          fecharModal(); atualizaContador(); renderProdutos();
          toast(meu ? 'Produto apagado' : 'Tirado deste celular');
          if (meu) agendarSync();
        });
      };
    });
  }
  const linhaInfo = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;

  function renderNotas(p) {
    const ns = (p.notas || []).slice().sort((a, b) => b.t - a.t);
    if (!ns.length) return '<p class="hint" style="margin:0 0 10px">Nenhuma nota ainda.</p>';
    return '<table class="br" style="margin-bottom:10px">' + ns.map(n =>
      `<tr><td>${esc(n.txt)}<span class="ref">${dataCurta(n.t)}</span></td>
       <td><span class="chip" data-apaganota="${n.t}" style="padding:3px 9px">×</span></td></tr>`).join('') + '</table>';
  }

  function ligarApagarNota(p) {
    $('#modal-body').querySelectorAll('[data-apaganota]').forEach(b => b.onclick = () => {
      p.notas = (p.notas || []).filter(n => String(n.t) !== b.dataset.apaganota);
      p.atualizado = Date.now();
      DB.salvarProduto(p).then(() => {
        $('#m-notas').innerHTML = renderNotas(p);
        ligarApagarNota(p);
        renderProdutos();
      });
    });
  }

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
  let PRECOS = null;                         // data/precos.json (faixa de varejo no Brasil)
  let guia = { cat: null, prod: null, cod: null, caminho: [] };

  function carregarProdutos() {
    return fetch('data/produtos.json').then(r => r.json()).then(j => { PRODUTOS = j; })
      // preços são opcionais: se o arquivo não existir, o app segue sem a comparação
      .then(() => fetch('data/precos.json').then(r => r.json())
        .then(j => { PRECOS = j.precos || null; })
        .catch(() => { PRECOS = null; }));
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

    /* Calculadora de bolso: a pergunta que se faz em pé no estande é
       "quanto isso custa nacionalizado?". Preço e quantidade bastam —
       o resto vem da Config. */
    const qc = Object.assign({ preco: 0, moeda: 'USD', qtd: 1000, cbm: 0.002 }, cfg.rapida || {});
    if (alvo && alvo.preco > 0) { qc.preco = alvo.preco; qc.moeda = alvo.moeda; }
    if (alvo && (alvo.qtd || alvo.moq)) { qc.qtd = alvo.qtd || alvo.moq; }
    if (alvo && alvo.cbm > 0) { qc.cbm = alvo.cbm; }

    const custoHtml = `<div class="card" id="qc-card">
      <h3 style="margin-bottom:10px">Quanto fica no Brasil</h3>
      <div class="row">
        <div class="f"><label for="qc-preco">Preço no estande</label>
          <input id="qc-preco" type="number" inputmode="decimal" step="0.01" value="${qc.preco || ''}" placeholder="0,00"></div>
        <div class="f f-sm"><label for="qc-moeda">Moeda</label>
          <select id="qc-moeda"><option${qc.moeda === 'USD' ? ' selected' : ''}>USD</option><option${qc.moeda === 'CNY' ? ' selected' : ''}>CNY</option></select></div>
      </div>
      <div class="row">
        <div class="f"><label for="qc-qtd">Quantidade</label>
          <input id="qc-qtd" type="number" inputmode="numeric" value="${qc.qtd}"></div>
        <div class="f"><label for="qc-cbm">m³ por peça</label>
          <input id="qc-cbm" type="number" inputmode="decimal" step="0.0001" value="${qc.cbm}"></div>
      </div>
      <p class="hint" style="margin:0 0 10px">Caixa de caneca ≈ 0,002 · caixa de sapato ≈ 0,008 ·
      luminária média ≈ 0,02. Ajuste no olho; erro aqui mexe pouco no total.</p>
      <label class="chk" style="margin:0 0 12px"><input type="checkbox" id="qc-fixas"${cfg.rapidaFixas ? ' checked' : ''}>
        Ratear despesas do embarque neste produto</label>
      <div id="qc-saida"></div>
    </div>`;

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
             : `<button class="primary big" id="g-salvar">Salvar este produto</button>
                ${produtos.length ? '<button class="ghost" id="g-escolher" style="margin-top:9px">Anexar a um produto já salvo</button>' : ''}`}
      <button class="ghost" id="g-detalhe" style="margin-top:9px">Ver detalhe técnico (para o Leonardo)</button>
      <button class="ghost" id="g-outro" style="margin-top:0">Classificar outro produto</button>`;

    /* ---- calculadora de bolso ---- */
    const calcRapido = () => {
      const p = {
        ncm: ncm, ii: it.ii, ipi: it.ipi, moeda: $('#qc-moeda').value,
        preco: parseFloat($('#qc-preco').value) || 0,
        qtd: parseInt($('#qc-qtd').value) || 0,
        cbm: parseFloat($('#qc-cbm').value) || 0
      };
      // sem peso informado, estima pela densidade típica de bem de consumo
      // embalado (~200 kg/m³); no LCL o que manda é o maior entre m³ e tonelada
      p.peso = p.cbm * 200;
      cfg.rapida = { preco: p.preco, moeda: p.moeda, qtd: p.qtd, cbm: p.cbm };
      DB.setCfg('rapida', cfg.rapida);

      const saida = $('#qc-saida');
      if (!p.preco || !p.qtd) {
        saida.innerHTML = '<p class="hint" style="margin:0">Preencha preço e quantidade.</p>';
        return;
      }
      /* Despachante, THC, armazenagem e Siscomex são custos do EMBARQUE,
         não do produto: o mesmo contêiner leva vários produtos e paga uma
         vez só. Jogar tudo em cima de um item é errado em qualquer
         quantidade, e com quantidade baixa produz número absurdo com cara
         de verdade. Aqui ficam de fora por padrão; quem quer a conta cheia
         do lote usa a aba Custos.                                          */
      const incluirFixas = $('#qc-fixas') ? $('#qc-fixas').checked : false;
      cfg.rapidaFixas = incluirFixas;
      DB.setCfg('rapidaFixas', incluirFixas);
      const cfgQC = incluirFixas ? cfg
        : Object.assign({}, cfg, { despesasBrl: 0, siscomexBrl: 0 });
      const c = CUSTOS.calcular(p, cfgQC);

      const ref = PRECOS ? PRECOS[guia.prod ? guia.prod.n : ''] : null;
      let refHtml = '';
      if (ref) {
        if (c.unitLiquido >= ref.max) {
          refHtml = `<div class="alerta bad" style="margin:12px 0 0">
            <b>Não fecha</b>Esse produto se vende no Brasil entre ${brl(ref.min)} e ${brl(ref.max)},
            e o seu custo efetivo é ${brl(c.unitLiquido)} — acima do teto do mercado.
            ${pesoFixas > 0.25 ? 'Confira a quantidade antes de descartar: ela pode estar distorcendo a conta.' : 'Nessa condição não há margem.'}
            <span class="ref" style="display:block;margin-top:6px">${esc(ref.nota)}</span></div>`;
        } else {
          const margemMin = ref.min > 0 ? (1 - c.unitLiquido / ref.min) * 100 : 0;
          const margemMax = ref.max > 0 ? (1 - c.unitLiquido / ref.max) * 100 : 0;
          const bom = margemMax >= 35;
          refHtml = `<div class="alerta ${bom ? 'ok' : 'warn'}" style="margin:12px 0 0">
            <b>Venda no Brasil: ${brl(ref.min)} a ${brl(ref.max)}</b>
            Com custo efetivo de ${brl(c.unitLiquido)}, a margem fica entre
            <b>${margemMin < 0 ? '0' : margemMin.toFixed(0)}%</b> e <b>${margemMax.toFixed(0)}%</b> sobre o preço de venda.
            ${margemMin < 0 ? '<br>No piso da faixa você vende no prejuízo.' : ''}
            <span class="ref" style="display:block;margin-top:6px">${esc(ref.nota)}</span></div>`;
        }
      }
      saida.innerHTML = `
        <div class="kpi" style="margin-bottom:0">
          <div><div class="k-l">Custo por peça</div><div class="k-v hi">${brl(c.unit)}</div>
            <div class="k-s">${incluirFixas ? 'com despesas do embarque' : 'produto + frete + impostos'}</div></div>
          <div><div class="k-l">Efetivo por peça</div><div class="k-v">${brl(c.unitLiquido)}</div>
            <div class="k-s">${c.aproveita ? 'descontando créditos' : 'Simples: sem crédito'}</div></div>
          <div><div class="k-l">Multiplicador</div><div class="k-v">${c.multiplo.toFixed(2)}×</div>
            <div class="k-s">sobre o preço do estande</div></div>
          <div><div class="k-l">Total do lote</div><div class="k-v" style="font-size:17px">${brl(c.total)}</div>
            <div class="k-s">${c.qtd.toLocaleString('pt-BR')} peça${c.qtd > 1 ? 's' : ''}</div></div>
        </div>
        ${refHtml}
        <p class="hint">Inclui II, IPI, PIS, COFINS, ICMS, AFRMM e o frete internacional.
        ${incluirFixas
          ? `Inclui também ${brl(cfg.despesasBrl + cfg.siscomexBrl)} de despesas do embarque, rateadas por ${c.qtd.toLocaleString('pt-BR')} peça${c.qtd > 1 ? 's' : ''}.`
          : 'Não inclui despachante, THC, armazenagem nem Siscomex — essas são do embarque inteiro, que leva vários produtos, e não deste item sozinho.'}
        Antidumping, quando existe, entra por fora.</p>`;
    };
    ['qc-preco', 'qc-moeda', 'qc-qtd', 'qc-cbm', 'qc-fixas'].forEach(id => {
      const e = $('#' + id); if (e) e.oninput = e.onchange = calcRapido;
    });
    calcRapido();

    const ba = $('#g-atribuir');
    if (ba) ba.onclick = () => { atribuir(alvo, r); gReset(); };
    /* Salvar direto daqui. Antes, quem vinha pela foto caía num beco:
       o app pedia para "salvar em um produto" que ainda não existia, e o
       formulário com fabricante e contato nunca aparecia. */
    const bs = $('#g-salvar');
    if (bs) bs.onclick = () => formSalvar(ncm, it);

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

  /* Formulário de salvamento vindo da classificação. Pede o que NÃO dá para
     recuperar depois: quem é o fabricante e como falar com ele. Preço e
     quantidade já vêm da calculadora; o estande e o contato ficam lembrados,
     porque no mesmo estande se captura vários produtos seguidos. */
  function formSalvar(ncm, it) {
    // os campos da captura: o cartão ou a placa podem ter acabado de trocar o fornecedor
    const ult = $('#f-forn') ? { forn: $('#f-forn').value.trim(), contato: $('#f-contato').value.trim(),
      estande: $('#f-estande').value.trim(), fase: $('#f-fase').value } : (cfg.ultimoForn || {});
    const nomeSugerido = guia.prod ? guia.prod.n.split(' / ')[0] : '';
    const nomeDigitado = $('#f-nome') ? $('#f-nome').value.trim() : '';
    const qcP = $('#qc-preco'), qcQ = $('#qc-qtd'), qcC = $('#qc-cbm'), qcM = $('#qc-moeda');
    const nFotos = pendentes.length;

    modal(`
      <h1 style="font-size:18px;margin:0 0 3px">Salvar produto</h1>
      <p class="hint" style="margin:0 0 14px">NCM ${fmtNcm(ncm)} · ${esc(it.desc.slice(0, 60))}
      ${nFotos ? ' · ' + nFotos + ' foto' + (nFotos > 1 ? 's' : '') : ''}</p>

      <div class="card" style="margin:0 0 14px;background:var(--bg2)">
        <label style="display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:9px">
          Sua nota para este produto <b>*</b></label>
        <div class="notas" id="s-nota">
          ${[1,2,3,4,5,6,7,8,9,10].map(n => `<button type="button" data-nota="${n}">${n}</button>`).join('')}
        </div>
        <p class="hint" style="margin:9px 0 0">Impressão sua, no calor do estande: qualidade, preço,
        atendimento. É por ela que vocês vão ordenar tudo depois da feira.</p>
      </div>

      <div class="f"><label for="s-nome">Produto <b>*</b></label>
        <input id="s-nome" type="text" value="${esc(nomeDigitado || nomeSugerido)}" placeholder="ex.: caneca branca 400ml"></div>

      <div class="f"><label for="s-forn">Fabricante / fornecedor <b>*</b></label>
        <input id="s-forn" type="text" value="${esc(ult.forn || '')}" placeholder="nome da empresa no estande"></div>

      <div class="f"><label for="s-contato">Contato — WeChat, e-mail ou telefone <b>*</b></label>
        <input id="s-contato" type="text" value="${esc(ult.contato || '')}" placeholder="peça o cartão e copie o WeChat ID"></div>

      <div class="row">
        <div class="f"><label for="s-estande">Nº do estande</label>
          <input id="s-estande" type="text" value="${esc(ult.estande || '')}" placeholder="ex.: 11.2 K23"></div>
        <div class="f"><label for="s-fase">Fase</label>
          <select id="s-fase"><option value="2">Fase 2</option><option value="3"${ult.fase === '3' ? ' selected' : ''}>Fase 3</option><option value="1"${ult.fase === '1' ? ' selected' : ''}>Fase 1</option></select></div>
      </div>

      <div class="row">
        <div class="f"><label for="s-preco">Preço unit.</label>
          <input id="s-preco" type="number" inputmode="decimal" step="0.01" value="${qcP ? qcP.value : ''}"></div>
        <div class="f f-sm"><label for="s-moeda">Moeda</label>
          <select id="s-moeda"><option>USD</option><option${qcM && qcM.value === 'CNY' ? ' selected' : ''}>CNY</option></select></div>
      </div>
      <div class="row">
        <div class="f"><label for="s-qtd">Quantidade</label>
          <input id="s-qtd" type="number" inputmode="numeric" value="${qcQ ? qcQ.value : ''}"></div>
        <div class="f"><label for="s-moq">MOQ do fornecedor</label>
          <input id="s-moq" type="number" inputmode="numeric" placeholder="peças"></div>
      </div>

      <div class="f"><label for="s-obs">Observações</label>
        <textarea id="s-obs" rows="2" placeholder="qualidade, prazo, amostra, o que ele falou…"></textarea></div>

      <div id="s-erro"></div>
      <button class="primary big" id="s-ok">Salvar</button>`);

    let notaEscolhida = 0;
    $('#modal-body').querySelectorAll('#s-nota button').forEach(b => b.onclick = () => {
      notaEscolhida = +b.dataset.nota;
      $('#modal-body').querySelectorAll('#s-nota button')
        .forEach(x => x.classList.toggle('on', +x.dataset.nota === notaEscolhida));
    });

    $('#s-ok').onclick = () => {
      const nome = $('#s-nome').value.trim();
      const forn = $('#s-forn').value.trim();
      const contato = $('#s-contato').value.trim()
        || (pendentes.some(m => m.cartao) ? 'na foto do cartão' : '');
      const faltou = [];
      if (!notaEscolhida) faltou.push('nota');
      if (!nome) faltou.push('produto');
      if (!forn) faltou.push('fabricante');
      if (!contato) faltou.push('contato');
      if (faltou.length) {
        $('#s-erro').innerHTML = `<div class="alerta bad" style="margin-bottom:10px">
          <b>Faltou preencher: ${faltou.join(', ')}</b>
          A nota e o contato são o que você não recupera depois — a impressão some
          e o fornecedor não se acha sozinho.</div>`;
        return;
      }
      const id = DB.novoId();
      const p = {
        id, nome, forn, contato,
        nota: notaEscolhida,
        desc: $('#f-desc') ? $('#f-desc').value.trim() : '',
        estande: $('#s-estande').value.trim(),
        fase: $('#s-fase').value,
        preco: parseFloat($('#s-preco').value) || 0,
        moeda: $('#s-moeda').value,
        qtd: parseInt($('#s-qtd').value) || 0,
        moq: parseInt($('#s-moq').value) || 0,
        cbm: qcC ? (parseFloat(qcC.value) || 0) : 0,
        peso: qcC ? (parseFloat(qcC.value) || 0) * 200 : 0,
        obs: $('#s-obs').value.trim(),
        cond: condAtual,
        ncm: ncm, ncmDesc: it.desc, ii: it.ii, ipi: it.ipi,
        cat: guia.prod ? guia.prod.cat : '',
        nomeDic: guia.prod ? guia.prod.n : '',
        status: 'novo', notas: [],
        criado: Date.now(), atualizado: Date.now()
      };
      // lembra o estande para o próximo produto do mesmo fornecedor, aqui e na captura
      cfg.ultimoForn = { forn, contato, estande: p.estande, fase: p.fase };
      DB.setCfg('ultimoForn', cfg.ultimoForn);
      if ($('#f-forn')) {
        $('#f-forn').value = forn;
        $('#f-contato').value = $('#s-contato').value.trim();
        $('#f-estande').value = p.estande;
        $('#f-fase').value = p.fase;
      }

      const midias = pendentes.map(m => ({ id: m.id, produtoId: id, blob: m.blob, tipo: m.tipo, nome: m.nome,
        cartao: !!m.cartao, audio: !!m.audio, placa: !!m.placa }));
      miniaturaDe(midias)
        .then(mini => { if (mini) p.miniatura = mini; return DB.salvarProduto(p); })
        .then(() => Promise.all(midias.map(m => DB.salvarMidia(m))))
        .then(() => {
          produtos.push(p);
          pendentes = [];
          agendarSync();
          limparForm();
          atualizaContador();
          fecharModal();
          gReset();
          toast('Salvo: ' + nome);
          ir('produtos');
        })
        .catch(e => {
          $('#s-erro').innerHTML = `<div class="alerta bad" style="margin-bottom:10px">
            <b>Não consegui salvar</b>${esc(e.message || e)}<br>
            Se você está no Safari em aba privada, saia dela: o armazenamento fica bloqueado.</div>`;
        });
    };
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
    // a categoria vem de graça da classificação guiada — é o que organiza
    // a lista depois da feira, sem ninguém ter que taguear à mão
    if (guia.prod && guia.prod.cat && !p.cat) p.cat = guia.prod.cat;
    if (guia.prod) p.nomeDic = guia.prod.n;   // chave da faixa de preço no Brasil
    if (p.paraRevisar) p.paraRevisar = false;
    p.ncmIa = false;
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

    /* Os mesmos controles da calculadora da aba NCM. Antes esta tela usava
       só o que estava salvo no produto e sempre rateava as despesas do
       embarque — com quantidade 1 isso dava R$ 4.887 num tênis de USD 50.
       Duas telas discordando é pior que uma errada.                      */
    const ratear = cfg.custosRatear !== false;   // aqui o padrão é ratear: é a conta do lote
    el.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="f"><label for="cx-preco">Preço unit. no estande</label>
            <input id="cx-preco" type="number" inputmode="decimal" step="0.01" value="${p.preco || ''}"></div>
          <div class="f f-sm"><label for="cx-moeda">Moeda</label>
            <select id="cx-moeda"><option>USD</option><option${p.moeda === 'CNY' ? ' selected' : ''}>CNY</option></select></div>
        </div>
        <div class="row">
          <div class="f"><label for="cx-qtd">Quantidade do pedido</label>
            <input id="cx-qtd" type="number" inputmode="numeric" value="${p.qtd || p.moq || ''}" placeholder="peças"></div>
          <div class="f"><label for="cx-cbm">m³ por peça</label>
            <input id="cx-cbm" type="number" inputmode="decimal" step="0.0001" value="${p.cbm || 0.002}"></div>
        </div>
        <label class="chk"><input type="checkbox" id="cx-ratear"${ratear ? ' checked' : ''}>
          Ratear despesas do embarque (despachante, THC, Siscomex)</label>
        <p class="hint">Aqui o padrão é ratear, porque esta é a conta do lote inteiro.
        O que você mudar fica salvo no produto.</p>
      </div>
      <div id="cx-saida"></div>`;

    const recalc = () => {
      p.preco = parseFloat($('#cx-preco').value) || 0;
      p.moeda = $('#cx-moeda').value;
      p.qtd = parseInt($('#cx-qtd').value) || 0;
      p.cbm = parseFloat($('#cx-cbm').value) || 0;
      p.peso = p.peso || p.cbm * 200;
      p.atualizado = Date.now();
      DB.salvarProduto(p);
      const r = $('#cx-ratear').checked;
      cfg.custosRatear = r; DB.setCfg('custosRatear', r);
      const cfgC = r ? cfg : Object.assign({}, cfg, { despesasBrl: 0, siscomexBrl: 0 });
      const qtdReal = p.qtd || p.moq || 0;
      const avisoQtd = (r && qtdReal > 0 && qtdReal < 50)
        ? `<div class="alerta bad" style="margin-bottom:12px"><b>Quantidade muito baixa para ratear</b>
           ${brl(cfg.despesasBrl + cfg.siscomexBrl)} de despesas do embarque divididos por
           ${qtdReal} peça${qtdReal > 1 ? 's' : ''} distorcem o custo unitário. Coloque a quantidade real
           do pedido, ou desmarque o rateio para ver só o custo do produto.</div>`
        : (qtdReal === 0
          ? `<div class="alerta warn" style="margin-bottom:12px"><b>Sem quantidade</b>
             A conta está usando 1 peça. Preencha a quantidade do pedido acima.</div>` : '');
      $('#cx-saida').innerHTML = avisoQtd + extratoHtml(p, CUSTOS.calcular(p, cfgC));
    };
    ['cx-preco', 'cx-moeda', 'cx-qtd', 'cx-cbm', 'cx-ratear'].forEach(id => {
      const e = $('#' + id); if (e) e.oninput = e.onchange = recalc;
    });
    recalc();
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
    $('#k-viagem').value = cfg.viagem || '';
    $('#k-disp').value = cfg.dispositivo || '';
    SYNC.configurar(cfg.viagem, cfg.dispositivo);
    pintarSync();
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
    const aplicaSync = () => {
      cfg.viagem = $('#k-viagem').value.trim();
      cfg.dispositivo = $('#k-disp').value.trim();
      DB.setCfg('viagem', cfg.viagem); DB.setCfg('dispositivo', cfg.dispositivo);
      SYNC.configurar(cfg.viagem, cfg.dispositivo);
      pintarSync();
    };
    $('#k-viagem').oninput = aplicaSync;
    $('#k-disp').oninput = aplicaSync;
    $('#btn-sync').onclick = () => sincronizar(true);
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
        : false).catch(() => false),
      DB.saudeMidias().catch(() => null)
    ]).then(([reg, estado, chaves, persistido, esp, temModelo, fotos]) => {
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
          ${fotos ? linha(!fotos.perdidas, 'Fotos, cartões, placas e áudios', fotos.perdidas
            ? fotos.boas + ' abrem, ' + fotos.perdidas + ' o iPhone perdeu (gravadas até a v20)'
            : fotos.boas + ' guardados, todos abrem') : ''}
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

  /* ---------------- sincronização ----------------
     Oportunista: tenta quando há rede e desiste em silêncio quando não há.
     Na mesclagem, vence a versão mais recente de cada produto — o relógio
     do aparelho basta porque ninguém edita o mesmo item em dois celulares
     ao mesmo tempo numa feira.                                            */
  function aplicarRecebidos(linhas) {
    if (!linhas.length) return Promise.resolve(0);
    const apagados = Object.assign({}, cfg.apagados);
    let n = 0, mudou = false;
    return linhas.reduce((fila, l) => fila.then(() => {
      if (apagados[l.id]) return;                    // apagado ou tirado daqui: não volta
      const existente = produtos.find(p => p.id === l.id);
      const quando = new Date(l.atualizado).getTime();
      if (existente && (existente.atualizado || 0) >= quando) return;   // o meu é mais novo
      if (l.apagado) {
        if (!existente) return;
        produtos = produtos.filter(x => x.id !== l.id);
        apagados[l.id] = { t: quando, meu: false };
        mudou = true;
        return DB.apagarProduto(l.id).then(() => { n++; });
      }
      const dados = l.dados || {};
      // sincAt = "como chegou": produto recebido e não mexido aqui não volta ao servidor
      const p = Object.assign({}, dados, { id: l.id, atualizado: quando, sincAt: quando,
        autor: dados.autor || l.dispositivo || '' });
      delete p.apagado;
      return DB.salvarProduto(p).then(() => {
        if (existente) produtos[produtos.indexOf(existente)] = p;
        else produtos.push(p);
        n++;
      });
    }), Promise.resolve()).then(() => {
      if (mudou) { cfg.apagados = apagados; DB.setCfg('apagados', apagados); }
      return n;
    });
  }

  /* Foto inteira não viaja (é 95% do peso), mas sem foto nenhuma o produto
     dos outros vira só um nome na lista. Vai uma miniatura de ~20 KB dentro
     do produto, feita da primeira foto que não é o cartão nem a placa. */
  function prepararMiniaturas() {
    const faltam = produtos.filter(p => !p.miniatura && !p.autor);
    return faltam.reduce((fila, p) => fila.then(() => DB.midiasDe(p.id).then(ms => {
      const foto = ms.find(fotoDoProduto);
      if (!foto) return;
      return imagemReduzida(foto.blob, 320, 0.6).then(url => {
        if (!url) return;
        p.miniatura = url;
        p.atualizado = Date.now();     // produto que já subiu sem foto sobe de novo
        return DB.salvarProduto(p);
      });
    })), Promise.resolve()).catch(() => {});
  }

  function abrirSync() {
    ir('config');
    setTimeout(() => {
      const k = $('#k-viagem');
      try { k.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
      if (!SYNC.ativo()) k.focus();
    }, 60);
  }

  function pintarSync() {
    const el = $('#sync-estado');
    if (!el) return;
    const s = SYNC.estado();
    if (!SYNC.ativo()) {
      el.innerHTML = '<p class="hint" style="margin:8px 0 0">Preencha o código para ativar.</p>';
      return;
    }
    if (!s) { el.innerHTML = '<p class="hint" style="margin:8px 0 0">Ainda não sincronizou nesta sessão.</p>'; return; }
    const hora = new Date(s.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    // o nome de quem já chegou é a prova de que os três estão no mesmo código
    const outros = [...new Set(produtos.filter(p => !ehMeu(p)).map(nomeAutor))];
    el.innerHTML = s.ok
      ? `<div class="alerta ok" style="margin:10px 0 0"><b>Sincronizado às ${hora}</b>
         ${s.enviados} enviado${s.enviados !== 1 ? 's' : ''}, ${s.recebidos} recebido${s.recebidos !== 1 ? 's' : ''}.
         <br>${outros.length ? 'Produtos de: <b>' + esc(outros.join(', ')) + '</b>.'
           : 'Ainda não chegou produto de outro celular. Confira se o código é o mesmo nos três.'}</div>`
      : `<div class="alerta warn" style="margin:10px 0 0"><b>Não sincronizou (${hora})</b>
         ${esc(s.motivo)}. Os produtos estão salvos no aparelho — tenta de novo quando houver rede.</div>`;
  }

  /* o que ainda não chegou ao servidor, pela versão que ele tinha na
     última rodada que deu certo */
  function pendentes_() {
    const srv = cfg.syncServidor || {};
    const subir = produtos.filter(p => p.sincAt !== p.atualizado
      && (p.atualizado || p.criado || 0) > (srv[p.id] || 0)).length;
    const apagados = cfg.apagados || {};
    return subir + Object.keys(apagados).filter(id => apagados[id].meu && apagados[id].t > (srv[id] || 0)).length;
  }

  let rodadaSync = null;
  function sincronizar(manual) {
    if (!SYNC.ativo()) { if (manual) toast('Preencha o código da viagem'); return Promise.resolve({ ok: false }); }
    if (manual) toast('Sincronizando…');
    if (rodadaSync) return rodadaSync;
    const apagados = cfg.apagados || {};
    const meusApagados = Object.keys(apagados).filter(id => apagados[id].meu)
      .map(id => ({ id, atualizado: apagados[id].t }));
    rodadaSync = (navigator.onLine ? prepararMiniaturas() : Promise.resolve())
      .then(() => SYNC.sincronizar(produtos, meusApagados, new Set(Object.keys(apagados)), aplicarRecebidos))
      .then(r => {
        if (r.ok) {
          const srv = {};
          r.servidor.forEach((v, id) => { srv[id] = v.t; });
          cfg.syncServidor = srv;
          DB.setCfg('syncServidor', srv);
          if (r.recebidos) renderProdutos();
          if (manual || r.recebidos) toast(`${r.enviados} enviado(s), ${r.recebidos} recebido(s)`);
        } else if (manual) {
          toast('Não sincronizou: ' + r.motivo);
        }
        atualizaContador();
        pintarSync();
        return r;
      })
      .then(r => { rodadaSync = null; return r; }, e => { rodadaSync = null; throw e; });
    return rodadaSync;
  }

  /* ---- automático ----
     A pessoa no estande não vai lembrar de apertar botão. Então o app tenta
     sozinho: ao abrir, ao voltar para a tela, quando a rede volta, e de
     tempos em tempos enquanto houver coisa pendente. Tudo em silêncio —
     falhar é normal com VPN e não pode atrapalhar quem está trabalhando. */
  let syncTimer = null;
  function agendarSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sincronizar(false), ms || 4000);
  }

  function autoSync() {
    // roda mesmo sem pendência própria: é assim que chega o que os outros cadastraram
    if (SYNC.ativo() && navigator.onLine) sincronizar(false);
  }

  /* ---------------- exportar / importar ---------------- */
  /* No iPhone, baixar um arquivo joga ele no app Arquivos e a pessoa ainda
     precisa achar e compartilhar. Com o menu nativo de compartilhamento o
     AirDrop aparece direto — e AirDrop é ponto a ponto, funciona sem
     internet nenhuma, que é a situação de vocês na China. */
  function baixar(nome, blob) {
    const file = new File([blob], nome, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: nome })
        .catch(() => baixarDireto(nome, blob));
      return;
    }
    baixarDireto(nome, blob);
  }

  function baixarDireto(nome, blob) {
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
        id: m.id, produtoId: m.produtoId, tipo: m.tipo, nome: m.nome, dados: d,
        cartao: !!m.cartao, audio: !!m.audio, placa: !!m.placa
      }))));
    }).then(midias => {
      const pacote = { app: 'canton-scout', versao: 1, exportado: new Date().toISOString(), cfg, produtos, midias };
      baixar(`canton-scout-${hoje()}.json`, new Blob([JSON.stringify(pacote)], { type: 'application/json' }));
      toast('Backup gerado — guarde no notebook');
    });
  }

  function exportarCsv() {
    const cab = ['Nota', 'Favorito', 'Categoria', 'Situação', 'Produto', 'NCM', 'Descrição NCM', 'II %', 'IPI %',
      'PIS %', 'COFINS %', 'Risco', 'Órgãos anuentes',
      'Antidumping', 'Fornecedor', 'Estande', 'Fase', 'Contato', 'Moeda', 'Preço FOB', 'MOQ',
      'Qtd', 'Peso kg', 'CBM', 'Custo/un BRL', 'Custo efetivo/un BRL', 'Multiplicador FOB',
      'Venda Brasil min', 'Venda Brasil max', 'Observações', 'Notas', 'NCM sugerida pela IA'];
    const linhas = produtos.map(p => {
      const r = p.ncm ? BASE.risco(p.ncm, { cond: p.cond, texto: p.nome + ' ' + p.desc }) : null;
      const c = (p.ncm && typeof p.ii === 'number') ? CUSTOS.calcular(p, cfg) : null;
      const pc = p.ncm ? CUSTOS.pisCofinsDe(p.ncm) : null;
      const ref = PRECOS && PRECOS[p.nomeDic || ''] ? PRECOS[p.nomeDic] : null;
      return [p.nota || '', p.fav ? 'SIM' : '', nomeCat(p.cat), statusDe(p.status).nome, p.nome, p.ncm || '', p.ncmDesc || '',
        typeof p.ii === 'number' ? p.ii : '', p.ipi === 'NT' ? 'NT' : (typeof p.ipi === 'number' ? p.ipi : ''),
        pc ? pc.pis : '', pc ? pc.cofins : '',
        r ? r.rotulo : 'sem NCM', r ? r.orgaos.join(' / ') : '',
        r ? r.antidumping.map(m => m.prod).join(' / ') : '',
        p.forn, p.estande, p.fase, p.contato, p.moeda, p.preco, p.moq, p.qtd, p.peso, p.cbm,
        c ? c.unit.toFixed(2) : '', c ? c.unitLiquido.toFixed(2) : '', c ? c.multiplo.toFixed(2) : '',
        ref ? ref.min : '', ref ? ref.max : '',
        p.obs,
        (p.notas || []).map(n => dataCurta(n.t) + ': ' + n.txt).join(' | '),
        p.ncm && p.ncmIa ? 'SIM' : ''];
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
          DB.salvarMidia({ id: m.id, produtoId: m.produtoId, blob: b, tipo: m.tipo, nome: m.nome,
            cartao: !!m.cartao, audio: !!m.audio, placa: !!m.placa })))))
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

  /* Rodar no navegador em vez do app instalado é a falha silenciosa mais
     cara: tudo parece funcionar, mas sem service worker não abre offline e
     o iOS descarta os dados depois de alguns dias. Então o app avisa. */
  function avisoInstalacao() {
    const el = $('#instalar');
    if (!el) return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (standalone) { el.hidden = true; return; }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    el.hidden = false;
    el.innerHTML = `<b>Falta instalar na tela de início</b>
      <p>Assim, do navegador, o app <b>não abre sem internet</b> e o celular pode
      apagar os produtos depois de alguns dias. ${ios
        ? 'No Safari: toque no botão de <b>compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.'
        : 'No Chrome: menu <b>⋮</b> e depois <b>Instalar aplicativo</b>.'}
      <br><a href="comecar.html">Ver o passo a passo com imagens →</a></p>`;
  }

  function iniciar() {
    const msg = $('#splash-msg'), bar = $('#splash-bar');
    avisoInstalacao();

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
        // repõe o estande do último produto: num mesmo fornecedor são vários
        if (cfg.ultimoForn) {
          $('#f-forn').value = cfg.ultimoForn.forn || '';
          $('#f-contato').value = cfg.ultimoForn.contato || '';
          $('#f-estande').value = cfg.ultimoForn.estande || '';
          if (cfg.ultimoForn.fase) $('#f-fase').value = cfg.ultimoForn.fase;
        }
        pintarConfig(); ligarConfig();
        atualizaContador();      // de novo: só agora o código da viagem foi lido
        // fotos gravadas até a v20 viram bytes; as que o iPhone já perdeu são marcadas
        DB.migrarMidias().then(r => {
          if (r.convertidas || r.perdidas) renderProdutos();
          if (r.perdidas) toast(r.perdidas + (r.perdidas > 1 ? ' fotos antigas não abrem mais' : ' foto antiga não abre mais')
            + ' — o resto do cadastro está salvo');
        }).catch(() => {});
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
    $('#cartao').onchange = (e) => { receberCartao(e.target.files[0]); e.target.value = ''; };
    $('#btn-audio').onclick = alternarGravacao;
    $('#placa').onchange = (e) => { receberPlaca(e.target.files[0]); e.target.value = ''; };
    $('#count-pill').onclick = abrirSync;
    $('#btn-salvar').onclick = salvarProduto;
    $$('#f-nota button').forEach(b => b.onclick = () => {
      notaCaptura = +b.dataset.nota;
      $$('#f-nota button').forEach(x => x.classList.toggle('on', +x.dataset.nota === notaCaptura));
    });
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
    window.addEventListener('online', () => { rede(); agendarSync(1500); });
    window.addEventListener('offline', rede);
    // ao voltar para o app depois de fotografar ou trocar de aba
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { rede(); agendarSync(2000); }
    });
    // enquanto o app estiver aberto, tenta de tempos em tempos
    setInterval(autoSync, 90000);
    // e logo depois de abrir
    agendarSync(5000);
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
              versaoNova = true;
              recarregarSePuder();
            }
          });
        });
        if (navigator.onLine) reg.update().catch(() => {});
      }).catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
