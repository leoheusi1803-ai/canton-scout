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
  let modelo = null, rotulos = null, mapa = null;
  let carregando = null;

  const TAM = 224;              // entrada do MobileNet V2
  /* Nos testes, todo acerto veio com confiança alta e todo erro veio abaixo
     de ~12%. Sugerir com pouca confiança é pior que não sugerir: a pessoa
     no estande toca no primeiro item e leva uma NCM errada. Então o topo
     precisa de 20%; abaixo disso o app assume que não sabe.              */
  const MIN_TOPO = 0.20;        // confiança mínima da 1ª sugestão
  const MIN_ALT = 0.06;         // alternativas só aparecem se o topo passou

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
        modelo = m; rotulos = r; mapa = v.mapa;
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

  /* Converte o arquivo numa imagem já no tamanho da rede */
  function paraImagem(blob) {
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

  function classificar(blob, quantos) {
    quantos = quantos || 3;
    if (!modelo) return Promise.reject(new Error('modelo ainda não carregado'));
    return paraImagem(blob).then(img => {
      const canvas = recortarQuadrado(img);
      // MobileNet V2 do TF-slim espera float em [-1, 1] e devolve LOGITS,
      // não probabilidade. Sem o softmax os números passavam de 100% e o
      // limiar de confiança virava enfeite.
      const bruto = tf.tidy(() => {
        const t = tf.browser.fromPixels(canvas).toFloat()
          .div(127.5).sub(1).expandDims(0);
        let saida = modelo.predict(t);
        if (Array.isArray(saida)) saida = saida[0];
        return saida.squeeze().dataSync();
      });
      const menor = Math.min.apply(null, bruto);
      let soma = 0; for (let i = 0; i < bruto.length; i++) soma += bruto[i];
      const jaEhProbabilidade = menor >= 0 && Math.abs(soma - 1) < 0.05;

      let vals;
      if (jaEhProbabilidade) {
        vals = Array.from(bruto);
      } else {
        // softmax estável: desconta o máximo antes de exponenciar
        const max = Math.max.apply(null, bruto);
        let acc = 0;
        const exp = new Array(bruto.length);
        for (let i = 0; i < bruto.length; i++) { exp[i] = Math.exp(bruto[i] - max); acc += exp[i]; }
        vals = exp.map(v => v / acc);
      }

      // saída com 1001 posições traz "fundo" no índice 0
      const desloc = vals.length === 1001 ? 1 : 0;
      const ordenado = vals
        .map((p, i) => ({ p, rot: rotulos[i - desloc] }))
        .filter(x => x.rot)
        .sort((a, b) => b.p - a.p);

      // consolida por produto do dicionário: duas classes podem apontar
      // para o mesmo item ("pot" e "wok" são a mesma panela)
      const porProduto = new Map();
      for (const x of ordenado.slice(0, 15)) {
        const prod = mapa[x.rot];
        if (!prod) continue;
        const atual = porProduto.get(prod);
        if (atual) { atual.p += x.p; atual.rots.push(x.rot); }
        else porProduto.set(prod, { produto: prod, p: x.p, rots: [x.rot] });
      }

      const ordenadoProd = Array.from(porProduto.values()).sort((a, b) => b.p - a.p);
      const sugestoes = (ordenadoProd.length && ordenadoProd[0].p >= MIN_TOPO)
        ? ordenadoProd.filter(s => s.p >= MIN_ALT).slice(0, quantos)
        : [];

      return {
        sugestoes,
        // o que o modelo viu, mesmo sem produto correspondente — ajuda a entender o erro
        bruto: ordenado.slice(0, 3).map(x => ({ rot: x.rot, p: x.p }))
      };
    });
  }

  return { carregar, classificar, prontoParaUso };
})();
