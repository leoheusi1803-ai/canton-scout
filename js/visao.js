/* ============================================================
   visao.js — reconhecimento de produto pela foto, DENTRO do aparelho.

   MobileNet V2 rodando via TensorFlow.js. Nenhum byte sai do celular,
   então funciona atrás do Great Firewall igual funciona em casa.
   O modelo reconhece o OBJETO ("isto é uma caneca"); o material continua
   sendo perguntado, porque é o material que decide a NCM — e nenhum
   modelo de imagem distingue porcelana de grés com confiança.
   A sugestão sempre passa por confirmação de quem está no estande.
   ============================================================ */
const VISAO = (() => {
  let modelo = null, rotulos = null, mapa = null, busca = {};
  let carregando = null;

  const TAM = 224;              // entrada do MobileNet V2
  /* Limiar calibrado medindo, não no olho. Na última bateria, TODO erro
     ficou entre 26% e 37% e TODO acerto de 46% para cima — separação limpa.
     Acima do corte o app afirma; abaixo ele mostra como "não tenho certeza",
     então nada se perde: só deixa de ser apresentado como se fosse certeza.
     Errar com confiança é o pior resultado: a pessoa no estande toca no
     primeiro item e leva uma NCM errada sem desconfiar.                   */
  const MIN_TOPO = 0.42;        // daqui para cima o app afirma
  const MIN_ALT = 0.06;         // piso para aparecer como palpite fraco

  function injetarTf() {
    if (window.tf) return Promise.resolve();
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = 'js/tf.min.js';
      s.onload = () => ok();
      s.onerror = () => erro(new Error('não consegui carregar o TensorFlow.js'));
      document.head.appendChild(s);
    });
  }

  /* Carrega sob demanda: são 15 MB, não faz sentido no boot de quem
     só quer consultar a tabela. O service worker já guardou tudo. */
  function carregar(aviso) {
    if (modelo) return Promise.resolve(true);
    if (carregando) return carregando;
    const passo = (m) => { if (aviso) aviso(m); };

    carregando = injetarTf()
      .then(() => { passo('preparando o reconhecimento…'); return tf.ready(); })
      .then(() => Promise.all([
        tf.loadGraphModel('modelo/model.json'),
        fetch('data/imagenet-labels.json').then(r => r.json()),
        fetch('data/visao.json').then(r => r.json())
      ]))
      .then(([m, r, v]) => {
        modelo = m; rotulos = r; mapa = v.mapa; busca = v.busca || {};
        // aquece: a primeira inferência é sempre a mais lenta
        const zero = tf.zeros([1, TAM, TAM, 3]);
        const saida = modelo.predict(zero);
        saida.dispose(); zero.dispose();
        return true;
      })
      .catch(e => { carregando = null; throw e; });

    return carregando;
  }

  function prontoParaUso() { return !!modelo; }

  /* Decodifica o arquivo JÁ com a orientação EXIF aplicada.
     Foto de celular quase sempre vem com a flag de orientação, e nem todo
     navegador aplica ao desenhar no canvas. Sem isto, a caneca chega deitada
     e o modelo responde "spotlight" com 65% de confiança — errado e confiante,
     que é o pior resultado possível. createImageBitmap resolve na origem. */
  function paraImagem(blob) {
    if (self.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' })
        .catch(() => createImageBitmap(blob))
        .catch(() => porTagImg(blob));
    }
    return porTagImg(blob);
  }

  function porTagImg(blob) {
    return new Promise((ok, erro) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('imagem inválida')); };
      img.src = url;
    });
  }

  function recortarQuadrado(img) {
    // corta o centro: o produto costuma estar no meio do enquadramento
    const lado = Math.min(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = TAM; c.height = TAM;
    c.getContext('2d').drawImage(
      img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, TAM, TAM);
    return c;
  }

  /* enquadra a imagem inteira num quadrado, sem cortar nada.
     O recorte central sozinho perde o produto quando ele está
     encostado na borda do enquadramento — comum em foto de estande. */
  function enquadrarInteira(img) {
    const c = document.createElement('canvas');
    c.width = TAM; c.height = TAM;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, TAM, TAM);
    const r = Math.min(TAM / img.width, TAM / img.height);
    const w = img.width * r, h = img.height * r;
    g.drawImage(img, (TAM - w) / 2, (TAM - h) / 2, w, h);
    return c;
  }


  /* uma passada do modelo: devolve o vetor de probabilidades */
  function inferir(canvas) {
    const cru = tf.tidy(() => {
      const t = tf.browser.fromPixels(canvas).toFloat()
        .div(127.5).sub(1).expandDims(0);
      let saida = modelo.predict(t);
      if (Array.isArray(saida)) saida = saida[0];
      return saida.squeeze().dataSync();
    });
    // MobileNet V2 do TF-slim devolve LOGITS, não probabilidade
    const menor = Math.min.apply(null, cru);
    let soma = 0; for (let i = 0; i < cru.length; i++) soma += cru[i];
    if (menor >= 0 && Math.abs(soma - 1) < 0.05) return Array.from(cru);
    const max = Math.max.apply(null, cru);
    let acc = 0;
    const exp = new Array(cru.length);
    for (let i = 0; i < cru.length; i++) { exp[i] = Math.exp(cru[i] - max); acc += exp[i]; }
    return exp.map(v => v / acc);
  }

  function ranquear(vals) {
    const desloc = vals.length === 1001 ? 1 : 0;   // índice 0 é "fundo"
    return vals
      .map((p, i) => ({ p, rot: rotulos[i - desloc] }))
      .filter(x => x.rot)
      .sort((a, b) => b.p - a.p);
  }

  function consolidar(ordenado) {
    // duas classes podem apontar o mesmo item ("pot" e "wok" são a mesma panela)
    const porProduto = new Map();
    for (const x of ordenado.slice(0, 15)) {
      const prod = mapa[x.rot];
      if (!prod) continue;
      const atual = porProduto.get(prod);
      if (atual) { atual.p += x.p; atual.rots.push(x.rot); }
      else porProduto.set(prod, { produto: prod, p: x.p, rots: [x.rot] });
    }
    return Array.from(porProduto.values()).sort((a, b) => b.p - a.p);
  }

  function classificar(blob, quantos) {
    quantos = quantos || 3;
    if (!modelo) return Promise.reject(new Error('modelo ainda não carregado'));
    const t0 = Date.now();

    return paraImagem(blob).then(img => {
      const centro = recortarQuadrado(img);
      const inteira = enquadrarInteira(img);
      const tamanho = img.width + '×' + img.height;
      if (img.close) img.close();      // ImageBitmap: solta a memória já (zera width/height)

      let melhor = null;
      const tentadas = [];

      const avaliar = (v) => {
        const ordenado = ranquear(inferir(v.canvas));
        const prods = consolidar(ordenado);
        const topo = prods.length ? prods[0].p : 0;
        tentadas.push({ vista: v.nome, topo: topo, viu: ordenado[0] ? ordenado[0].rot : '—' });
        if (!melhor || topo > melhor.topo) melhor = { topo, prods, ordenado, vista: v.nome };
      };

      /* NÃO procurar a orientação girando a imagem. Testei: girar a caneca
         faz o modelo ver "spotlight" com confiança MAIOR do que ele vê
         "coffee mug" na foto em pé — então escolher a rotação mais confiante
         troca o acerto por um erro. A orientação se resolve na decodificação
         (createImageBitmap com from-image), não por tentativa e erro aqui.
         Aqui só variam o enquadramento, que é ambiguidade real da foto. */
      avaliar({ nome: 'centro', canvas: centro });
      avaliar({ nome: 'inteira', canvas: inteira });

      const prods = melhor ? melhor.prods : [];
      const forte = prods.length && prods[0].p >= MIN_TOPO;
      const sugestoes = forte ? prods.filter(s => s.p >= MIN_ALT).slice(0, quantos) : [];
      // abaixo do limiar: devolve separado e rotulado, para a tela avisar
      // que é palpite fraco em vez de simplesmente não dizer nada
      const fracas = forte ? [] : prods.filter(s => s.p >= MIN_ALT).slice(0, quantos);
      /* o modelo tem certeza do objeto, mas ele não está no dicionário de
         produtos: a "xícara de café" vista como "espresso" a 89% caía em
         "Não reconheci". Para os objetos com tradução conferida contra a
         tabela, devolve o termo em português para buscar na NCM.        */
      const topoBruto = melhor && melhor.ordenado[0];
      const termo = !forte && topoBruto && topoBruto.p >= MIN_TOPO && busca[topoBruto.rot]
        ? { rot: topoBruto.rot, p: topoBruto.p, q: busca[topoBruto.rot] } : null;

      return {
        sugestoes,
        fracas,
        termo,
        bruto: (melhor ? melhor.ordenado : []).slice(0, 3).map(x => ({ rot: x.rot, p: x.p })),
        diag: {
          ms: Date.now() - t0,
          backend: (tf.getBackend && tf.getBackend()) || '?',
          imagem: tamanho,
          vista: melhor ? melhor.vista : '—',
          tentadas: tentadas
        }
      };
    });
  }

  return { carregar, classificar, prontoParaUso };
})();
