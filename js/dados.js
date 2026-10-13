/* ============================================================
   dados.js — base fiscal embarcada, busca de NCM e motor de risco.
   Tudo roda offline: nenhuma chamada de rede depois do 1º carregamento.
   ============================================================ */
const BASE = (() => {

  let fiscal = null, anuencia = null, antidumping = null;
  let itens = [];                 // [{ncm,desc,path,cap,ii,iiFonte,ipi,mark}]
  const porNcm = new Map();
  let capitulos = {};

  // índice invertido: token -> array de índices de itens
  const idx = new Map();
  let tokensOrd = [];             // tokens ordenados, p/ busca por prefixo

  /* ---------------- normalização ---------------- */
  const STOP = new Set(['de','da','do','das','dos','e','ou','para','por','com','sem','a','o','as','os',
    'em','no','na','nos','nas','um','uma','que','outros','outras','outro','outra','suas','seus','seu','sua',
    'the','of','for','and','with','to','in','on','other','others','not','non','type','kind','made','use','used']);

  function norm(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function toks(s) {
    return norm(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t));
  }

  /* ---------------- dicionário PT <-> EN da feira ----------------
     Os estandes da Canton Fair atendem em inglês. A busca aceita
     o termo em inglês e procura pelos termos da NCM em português.  */
  const SIN = {
    // mesa, cozinha, casa (Fase 2)
    mug:'caneca xicara mesa cozinha domestico', cup:'copo xicara mesa cozinha domestico', glass:'copo vidro', plate:'prato mesa cozinha domestico', dish:'prato travessa',
    bowl:'tigela mesa cozinha domestico', tray:'bandeja travessa', cutlery:'cutelaria faca garfo colher', fork:'garfo',
    spoon:'colher', knife:'faca', pot:'panela caldeirao', pan:'panela frigideira', kettle:'chaleira',
    teapot:'bule cha', thermos:'garrafa termica', bottle:'garrafa', jar:'pote frasco', vase:'vaso',
    ceramic:'ceramica', ceramics:'ceramica', porcelain:'porcelana', stoneware:'gres ceramica',
    earthenware:'faianca ceramica', chinaware:'louca porcelana', tableware:'louca mesa servico',
    cookware:'panela cozinha', bakeware:'forma assar', cutting:'corte tabua', board:'tabua',
    opener:'abridor', strainer:'coador peneira', grater:'ralador', whisk:'batedor',
    napkin:'guardanapo', tablecloth:'toalha mesa', coaster:'porta copo',
    candle:'vela', holder:'suporte porta', frame:'moldura caixilho', mirror:'espelho',
    clock:'relogio', basket:'cesto cesta', hanger:'cabide', broom:'vassoura', mop:'esfregao',
    bucket:'balde', dustbin:'lixeira recipiente', organizer:'organizador caixa',
    // iluminação e elétricos
    lamp:'luminaria lampada aparelho iluminacao', light:'luminaria lampada iluminacao',
    lighting:'iluminacao luminaria', chandelier:'lustre luminaria', bulb:'lampada',
    led:'led diodo emissor luz', spotlight:'projetor luminaria', flashlight:'lanterna',
    fan:'ventilador', heater:'aquecedor', blender:'liquidificador', mixer:'batedeira misturador',
    juicer:'espremedor centrifuga', toaster:'torradeira', oven:'forno', microwave:'microondas forno',
    fryer:'fritadeira', cooker:'panela eletrica', iron:'ferro passar', vacuum:'aspirador',
    humidifier:'umidificador', purifier:'purificador filtro', speaker:'alto falante',
    headphone:'fone ouvido auscultador', earphone:'fone ouvido auscultador',
    charger:'carregador', cable:'cabo fio condutor', adapter:'adaptador', plug:'tomada ficha',
    socket:'tomada', switch:'interruptor', battery:'pilha acumulador bateria',
    powerbank:'acumulador eletrico bateria', bluetooth:'radiodifusao transmissao radio',
    camera:'camera aparelho fotografico', watch:'relogio pulso',
    // móveis (Fase 2)
    furniture:'movel moveis', chair:'cadeira assento', stool:'banco assento tamborete',
    sofa:'sofa assento', table:'mesa', desk:'mesa escrivaninha', shelf:'estante prateleira',
    cabinet:'armario movel', wardrobe:'armario guarda roupa', bed:'cama movel',
    mattress:'colchao', pillow:'almofada travesseiro', cushion:'almofada',
    // têxtil e vestuário (Fase 3)
    textile:'tecido materia textil', fabric:'tecido', cotton:'algodao', polyester:'poliester',
    viscose:'viscose', nylon:'nailon poliamida', wool:'la', silk:'seda', linen:'linho',
    knitted:'malha tricotado', woven:'tecido',
    towel:'toalha atoalhado felpudo toucador', bedding:'roupa cama', sheet:'lencol roupa cama',
    blanket:'cobertor manta', quilt:'edredao colcha', curtain:'cortina',
    carpet:'tapete revestimento', rug:'tapete',
    shirt:'camisa', tshirt:'camiseta camisola', blouse:'blusa camisa', dress:'vestido',
    skirt:'saia', pants:'calca', trousers:'calca', shorts:'short calca', jeans:'calca denim',
    jacket:'jaqueta blusao casaco', coat:'casaco sobretudo', sweater:'pulover suéter malha',
    hoodie:'pulover malha', underwear:'roupa interior cueca calcinha', bra:'sutia',
    sock:'meia', socks:'meia', pajamas:'pijama', swimwear:'maio biquini banho',
    uniform:'uniforme vestuario', baby:'bebe crianca',
    // calçados e acessórios
    shoe:'calcado sapato', shoes:'calcado sapato', sneaker:'tenis calcado esportivo',
    sandal:'sandalia calcado', slipper:'chinelo pantufa calcado', boot:'bota calcado',
    heel:'sapato salto calcado', sole:'sola calcado',
    bag:'bolsa saco', handbag:'bolsa', backpack:'mochila', suitcase:'mala',
    luggage:'mala bagagem', wallet:'carteira', purse:'bolsa carteira', belt:'cinto',
    hat:'chapeu', cap:'bone chapeu', glove:'luva', scarf:'lenco cachecol',
    umbrella:'guarda chuva sombrinha', sunglasses:'oculos sol',
    jewelry:'bijuteria joia', jewellery:'bijuteria joia', earring:'brinco',
    necklace:'colar', bracelet:'bracelete pulseira', ring:'anel',
    // escritório e papelaria (Fase 3)
    pen:'caneta esferografica', pencil:'lapis', marker:'marcador caneta',
    notebook:'caderno livro', paper:'papel', envelope:'envelope', folder:'pasta',
    stapler:'grampeador', scissors:'tesoura', tape:'fita adesiva', glue:'cola adesivo',
    calculator:'calculadora maquina calcular', printer:'impressora', toner:'cartucho tinta toner',
    // saúde e beleza (Fase 3)
    cosmetic:'cosmetico beleza', makeup:'maquiagem beleza', lipstick:'batom labios',
    shampoo:'xampu capilar', soap:'sabao sabonete', perfume:'perfume',
    cream:'creme', lotion:'locao', sunscreen:'protetor solar',
    toothbrush:'escova dente', toothpaste:'dentifricio pasta dente',
    brush:'escova pincel', comb:'pente', hairdryer:'secador cabelo',
    razor:'navalha aparelho barbear', nail:'unha', tweezer:'pinca', hair:'cabelo capilar',
    mask:'mascara', glove_med:'luva', syringe:'seringa', thermometer:'termometro',
    bandage:'atadura gaze', wheelchair:'cadeira rodas', crutch:'muleta',
    diaper:'fralda', supplement:'suplemento alimentar',
    // alimentos (Fase 3)
    food:'alimento comestivel', snack:'alimento preparacao', candy:'doce acucar confeitaria',
    chocolate:'chocolate cacau', coffee:'cafe', tea:'cha', juice:'suco',
    sauce:'molho condimento', spice:'tempero condimento especiaria', noodle:'macarrao massa',
    rice:'arroz', oil:'oleo azeite', honey:'mel',
    // brinquedos e presentes
    toy:'brinquedo', toys:'brinquedo', doll:'boneca bonecos', puzzle:'jogo quebra cabeca',
    game:'jogo', balloon:'balao bola inflavel', ball:'bola', bicycle:'bicicleta',
    scooter:'patinete trotineta', stroller:'carrinho bebe', gift:'presente artigo',
    decoration:'decoracao ornamento artigo', ornament:'ornamento estatueta',
    christmas:'natal festa artigo', party:'festa artigo divertimento',
    sticker:'adesivo decalcomania', keychain:'chaveiro',
    // ferramentas e construção
    tool:'ferramenta', drill:'furadeira perfuratriz', hammer:'martelo',
    screwdriver:'chave fenda parafusos', wrench:'chave porcas', pliers:'alicate',
    saw:'serra', screw:'parafuso', nail_metal:'prego', hinge:'dobradica',
    lock:'fechadura', padlock:'cadeado', handle:'maçaneta puxador',
    faucet:'torneira', tap:'torneira', pipe:'tubo', valve:'valvula',
    tile:'azulejo ladrilho ceramica', paint:'tinta', sealant:'vedante silicone',
    // materiais
    plastic:'plastico', steel:'aco ferro', stainless:'aco inoxidavel', iron_mat:'ferro',
    aluminum:'aluminio', aluminium:'aluminio', copper:'cobre', brass:'latao',
    zinc:'zinco', wood:'madeira', bamboo:'bambu', rattan:'vime rotim',
    rubber:'borracha', silicone:'silicone', leather:'couro', pu:'plastico poliuretano',
    paper_mat:'papel', cardboard:'papelao cartao', foam:'espuma',
    // termos de comércio
    set:'conjunto jogo surtido', kit:'conjunto surtido', pack:'embalagem',
    electric:'eletrico', electronic:'eletronico', manual:'manual', portable:'portatil',
    rechargeable:'recarregavel acumulador', solar:'solar fotovoltaico',
    waterproof:'impermeavel', inflatable:'inflavel', foldable:'dobravel',
    disposable:'descartavel', stainless_steel:'aco inoxidavel'
  };

  /* ---------------- afinidade de capítulo ----------------
     "sneaker" casa com graxa de sapato e com forma de calçado tão bem
     quanto com o tênis em si. Saber que tênis mora no capítulo 64
     desempata a favor do produto certo. Vale para o termo em inglês
     e para o que a pessoa digita em português.                       */
  const DICA_CAP = {
    // calçados
    shoe:'64', shoes:'64', sneaker:'64', sandal:'64', slipper:'64', boot:'64', heel:'64',
    calcado:'64', calcados:'64', tenis:'64', sapato:'64', sandalia:'64', chinelo:'64', bota:'64',
    // brinquedos e jogos
    toy:'95', toys:'95', doll:'95', puzzle:'95', game:'95', scooter:'95',
    brinquedo:'95', brinquedos:'95', boneca:'95', jogo:'95', patinete:'95',
    // mesa, cozinha, cerâmica, vidro
    mug:'69 70', cup:'69 70', plate:'69 70', bowl:'69 70', dish:'69 70',
    tableware:'69 70', chinaware:'69', ceramic:'69', ceramics:'69', porcelain:'69',
    stoneware:'69', earthenware:'69', caneca:'69 70', louca:'69', ceramica:'69',
    porcelana:'69', xicara:'69 70', prato:'69 70', tigela:'69 70',
    // cozinha em metal/plástico
    pot:'73 76 39', pan:'73 76 39', kettle:'73 76 39', cookware:'73 76 39',
    panela:'73 76 39', frigideira:'73 76', chaleira:'73 76',
    // têxteis de casa
    towel:'63 58', bedding:'63', sheet:'63', blanket:'63', quilt:'63', curtain:'63',
    carpet:'57', rug:'57', toalha:'63 58', lencol:'63', cobertor:'63', cortina:'63', tapete:'57',
    // vestuário
    shirt:'61 62', tshirt:'61 62', blouse:'61 62', dress:'61 62', skirt:'61 62',
    pants:'61 62', trousers:'61 62', jacket:'61 62', coat:'61 62', sweater:'61',
    hoodie:'61', underwear:'61 62', sock:'61', socks:'61', swimwear:'61 62',
    camisa:'61 62', camiseta:'61 62', vestido:'61 62', calca:'61 62', meia:'61',
    jaqueta:'61 62', blusa:'61 62',
    // móveis e iluminação
    furniture:'94', chair:'94', stool:'94', sofa:'94', desk:'94', shelf:'94',
    cabinet:'94', wardrobe:'94', bed:'94', mattress:'94', pillow:'94', cushion:'94',
    movel:'94', moveis:'94', cadeira:'94', sofa_pt:'94', armario:'94', colchao:'94',
    lamp:'94 85', light:'94 85', lighting:'94 85', chandelier:'94', bulb:'85',
    luminaria:'94', lustre:'94', lampada:'85 94',
    // malas e acessórios
    bag:'42', handbag:'42', backpack:'42', suitcase:'42', luggage:'42', wallet:'42', purse:'42',
    bolsa:'42', mochila:'42', mala:'42', carteira:'42',
    belt:'42 39', hat:'65', cap:'65', chapeu:'65', bone:'65',
    umbrella:'66', sunglasses:'90',
    jewelry:'71', jewellery:'71', earring:'71', necklace:'71', bracelet:'71', ring:'71',
    bijuteria:'71', brinco:'71', colar:'71', anel:'71',
    clock:'91', watch:'91', relogio:'91',
    // higiene, escovas, papelaria
    brush:'96', comb:'96', toothbrush:'96', escova:'96', pente:'96',
    pen:'96', pencil:'96', marker:'96', caneta:'96', lapis:'96',
    // cosméticos
    cosmetic:'33', makeup:'33', lipstick:'33', shampoo:'33', perfume:'33',
    cream:'33', lotion:'33', sunscreen:'33', toothpaste:'33',
    cosmetico:'33', maquiagem:'33', batom:'33', xampu:'33', creme:'33',
    // eletros
    fan:'84', heater:'85', blender:'84', mixer:'84', juicer:'84', toaster:'85',
    oven:'85', microwave:'85', fryer:'85', vacuum:'85', iron:'85',
    ventilador:'84', liquidificador:'84', aquecedor:'85', aspirador:'85',
    speaker:'85', headphone:'85', earphone:'85', charger:'85', cable:'85', battery:'85',
    // espelhos e vidro
    mirror:'70', espelho:'70', glass:'70', vidro:'70',
    // decoração
    vase:'69 70', candle:'34', frame:'44 83', decoration:'39 44 69 70 83',
    vaso:'69 70', vela:'34', moldura:'44 83',
    // ferramentas
    tool:'82', drill:'84 82', hammer:'82', screwdriver:'82', wrench:'82',
    pliers:'82', saw:'82', ferramenta:'82', martelo:'82', alicate:'82',
    lock:'83', padlock:'83', fechadura:'83', cadeado:'83'
  };

  function dicasDe(tokens) {
    const caps = new Set();
    for (const t of tokens) {
      const d = DICA_CAP[t];
      if (d) d.split(' ').forEach(c => caps.add(c));
    }
    return caps;
  }

  /* ---------------- carregamento ---------------- */
  function carregar(aviso) {
    const passo = (m, p) => { if (aviso) aviso(m, p); };
    passo('carregando base fiscal (TEC + TIPI)…', 10);

    return fetch('data/fiscal.json').then(r => r.json()).then(j => {
      fiscal = j;
      capitulos = j.capitulos || {};
      itens = j.itens.map(a => ({
        ncm: a[0], desc: a[1], path: a[2], cap: a[3],
        ii: a[4], iiFonte: a[5], ipi: a[6], mark: a[7] || ''
      }));
      itens.forEach(it => porNcm.set(it.ncm, it));
      passo('indexando ' + itens.length.toLocaleString('pt-BR') + ' códigos NCM…', 40);
      construirIndice();
      passo('carregando tratamento administrativo…', 60);
      return fetch('data/anuencia.json').then(r => r.json());
    }).then(j => {
      anuencia = j;
      passo('carregando medidas antidumping…', 85);
      return fetch('data/antidumping.json').then(r => r.json());
    }).then(j => {
      antidumping = j;
      prepararAntidumping();
      passo('pronto', 100);
      return true;
    });
  }

  function construirIndice() {
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      const capTxt = capitulos[it.cap] || '';
      // peso embutido na posição: desc (3) > path (1.5) > capítulo (0.7)
      addTokens(toks(it.desc), i, 3);
      addTokens(toks(it.path), i, 1.5);
      addTokens(toks(capTxt), i, 0.7);
    }
    tokensOrd = Array.from(idx.keys()).sort();
  }
  function addTokens(ts, i, peso) {
    for (const t of ts) {
      let a = idx.get(t);
      if (!a) { a = new Map(); idx.set(t, a); }
      const atual = a.get(i) || 0;
      if (peso > atual) a.set(i, peso);
    }
  }

  /* tokens indexados que começam com um prefixo (busca parcial) */
  function porPrefixo(pref) {
    const out = [];
    let lo = 0, hi = tokensOrd.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tokensOrd[m] < pref) lo = m + 1; else hi = m; }
    for (let i = lo; i < tokensOrd.length && tokensOrd[i].startsWith(pref); i++) out.push(tokensOrd[i]);
    return out;
  }

  /* ---------------- busca ---------------- */
  function buscar(q, limite) {
    limite = limite || 40;
    const cru = (q || '').trim();
    if (!cru) return { itens: [], expandido: [] };

    // consulta por código NCM
    const soDigitos = cru.replace(/[^0-9]/g, '');
    if (soDigitos.length >= 4 && /^[\d.\s]+$/.test(cru)) {
      const res = itens.filter(it => it.ncm.startsWith(soDigitos))
        .slice(0, limite).map(it => ({ it, score: 100 }));
      if (res.length) return { itens: res, expandido: ['código ' + soDigitos] };
    }

    // expansão por dicionário
    const base = toks(cru);
    const grupos = [];     // cada grupo = variantes de um termo da consulta
    const expandido = [];
    for (const t of base) {
      const vars = new Set([t]);
      if (SIN[t]) { SIN[t].split(' ').forEach(x => vars.add(x)); expandido.push(t + ' → ' + SIN[t]); }
      grupos.push(Array.from(vars));
    }
    if (!grupos.length) return { itens: [], expandido: [] };

    const pontos = new Map();     // índice do item -> soma dos melhores por grupo
    const cobertos = new Map();   // índice do item -> nº de grupos atingidos

    for (const vars of grupos) {
      // melhor peso que ESTE grupo consegue em cada item.
      // usar o melhor (e não a soma) evita que "ceramica/ceramicas/ceramico"
      // inflem o mesmo item três vezes pelo mesmo termo da consulta.
      const melhor = new Map();
      for (const v of vars) {
        const cands = [];
        if (idx.has(v)) cands.push([v, 1.0]);
        if (v.length >= 4) for (const t of porPrefixo(v)) if (t !== v) cands.push([t, 0.65]);
        // "toalha" precisa achar "atoalhados": casa como pedaço da palavra
        if (v.length >= 5) for (const t of tokensOrd) {
          if (t !== v && !t.startsWith(v) && t.includes(v)) cands.push([t, 0.5]);
        }
        for (const [t, fator] of cands) {
          const mapa = idx.get(t);
          if (!mapa) continue;
          for (const [i, peso] of mapa) {
            const p = peso * fator;
            if (p > (melhor.get(i) || 0)) melhor.set(i, p);
          }
        }
      }
      for (const [i, p] of melhor) {
        pontos.set(i, (pontos.get(i) || 0) + p);
        cobertos.set(i, (cobertos.get(i) || 0) + 1);
      }
    }

    const nG = grupos.length;
    const caps = dicasDe(base);                          // capítulos prováveis da consulta
    const res = [];
    for (const [i, s] of pontos) {
      const cob = cobertos.get(i) || 0;
      if (nG >= 3 && cob < 2) continue;                  // consulta longa exige ≥2 termos
      const it = itens[i];
      const score = caps.size && caps.has(it.cap) ? s * 2.2 : s;
      res.push({ it, score, cob, nG, noCap: caps.has(it.cap) });
    }
    // cobertura manda: casar TODOS os termos vence qualquer acúmulo de pontos
    res.sort((a, b) =>
      (b.cob - a.cob) ||
      (b.score - a.score) ||
      (a.it.ncm.localeCompare(b.it.ncm)));
    return { itens: res.slice(0, limite), expandido };
  }

  /* ---------------- antidumping ----------------
     A tabela oficial do DECOM lista produto/origem/prazo, mas NÃO traz NCM.
     Casar só por nome falha feio: a medida "Objetos de louça para mesa"
     não casa com o texto da NCM 6912, que fala em "serviços de mesa (…) de
     cerâmica" e nunca usa a palavra "louça". Por isso as posições abaixo
     foram mapeadas à mão a partir do produto descrito na medida.
     É um mapa de TRIAGEM: aponta onde olhar, não define escopo. O escopo
     real de cada medida está na Resolução Gecex que a instituiu.            */
  const AD_NCM = {
    'Objetos de louça para mesa': ['6911', '6912'],
    'Calçados': ['6401', '6402', '6403', '6404', '6405'],
    'Canetas esferográficas': ['960810'],
    'Lápis': ['960910'],
    'Escovas para cabelo': ['960329'],
    'Cadeados': ['830110'],
    'Chaves de latão': ['830170'],
    'Espelhos': ['7009'],
    'Vidros planos flotados incolores': ['7005'],
    'Vidros automotivos': ['7007'],
    'Ventiladores de mesa': ['841451'],
    'Alto-falantes': ['8518'],
    'Luvas': ['401512', '401519'],
    'Seringas descartáveis': ['901831'],
    'Agulhas hipodérmicas': ['901832'],
    'Tubos de coleta de sangue': ['901839'],
    'Malhas de poliéster': ['6004', '6006'],
    'Malhas de viscose': ['6004', '6006'],
    'Fios de poliéster': ['5402', '5509'],
    'Fios de náilon': ['5402'],
    'Fibras de poliéster': ['5503'],
    'Fibras de vidro': ['7019'],
    'Fibras ópticas': ['900110'],
    'Cabos de fibra ópticas': ['854470'],
    'Resina PET': ['390761', '390769'],
    'PVC-S': ['390410'],
    'Pneus de automóveis': ['401110'],
    'Pneus de carga': ['401120'],
    'Pneus de motocicletas': ['401140'],
    'Pneus agrícolas': ['401170', '401180'],
    'Ácido cítrico': ['291814', '291815'],
    'Alhos': ['070320'],
    'Lisina': ['292241'],
    'Cilindros para GNV': ['7311'],
    'Pigmento de dióxido de titânio': ['320611'],
    'Filtros cerâmicos refratários': ['6903', '6909']
  };

  let adChina = [];
  function prepararAntidumping() {
    adChina = (antidumping.medidas || []).map(a => ({
      prod: a[0], medida: a[1], origem: a[2], prazo: a[3],
      china: a[4], susp: a[5], rev: a[6],
      toks: toks(a[0]),
      ncms: AD_NCM[a[0]] || null
    })).filter(m => m.china);
  }

  /* texto = nome/descrição do produto + texto da NCM; ncm8 = código, se houver */
  function medidasAD(texto, ncm8) {
    const alvo = new Set(toks(texto));
    const out = [];
    for (const m of adChina) {
      // 1) casamento por NCM mapeada: sinal forte
      if (ncm8 && m.ncms && m.ncms.some(p => ncm8.startsWith(p))) {
        out.push(Object.assign({}, m, { via: 'ncm' }));
        continue;
      }
      // Se a medida já tem NCM mapeada e o código não bateu, ela não se aplica:
      // deixar o nome opinar aqui só gera ruído — "Luvas" casava com artigos de
      // cozinha porque o texto da NCM 7323 cita "luvas (…) para limpeza".
      if (m.ncms) continue;

      // 2) casamento por nome: só para as medidas ainda sem NCM mapeada
      if (!m.toks.length) continue;
      let bate = 0;
      for (const t of m.toks) {
        if (alvo.has(t)) { bate++; continue; }
        // casa radical: "calcados" x "calcado", "vidros" x "vidro"
        for (const a of alvo) {
          if (a.length >= 5 && t.length >= 5 && (a.startsWith(t.slice(0, 5)) || t.startsWith(a.slice(0, 5)))) { bate++; break; }
        }
      }
      // Exigir maioria dos termos, não dois quaisquer. Sem isso, "artigos de
      // cozinha de ferro ou aço" casava com "laminados planos de aço ao
      // silício" só por dividir a palavra "aço" — e um alarme falso desses
      // faz descartar uma categoria boa.
      const exige = m.toks.length === 1 ? 1 : Math.max(2, Math.ceil(m.toks.length * 0.6));
      if (bate >= exige) out.push(Object.assign({}, m, { via: 'nome' }));
    }
    return out;
  }

  /* ---------------- tratamento administrativo ---------------- */
  function regrasTA(ncm8, cond) {
    const usado = cond === 'usado';
    const out = [];
    for (const a of (anuencia.ta || [])) {
      const p = a[0];
      if (!ncm8.startsWith(p)) continue;
      const trat = a[3] || '';
      const soUsado = /material\s*usado/i.test(trat);
      if (soUsado && !usado) continue;                   // não assusta com regra de usado
      const reg = a[2] || '';
      let nivel = 1;
      if (/impedid/i.test(reg)) nivel = 4;
      else if (/n[ãa]o[\s-]*autom/i.test(reg)) nivel = 3;
      else if (/autom/i.test(reg)) nivel = 2;
      out.push({
        prefixo: p, orgao: a[1], regime: reg, trat, excecao: a[4], ex: a[5], desc: a[6],
        nivel,
        condicional: /destaque/i.test(trat) || /pa[íi]s/i.test(trat),
        soUsado
      });
    }
    // mais específico primeiro
    out.sort((x, y) => y.prefixo.length - x.prefixo.length || y.nivel - x.nivel);
    return out;
  }

  function regrasLPCO(ncm8) {
    const vistos = new Set(), out = [];
    for (const a of (anuencia.lpco || [])) {
      const p = a[0];
      if (!ncm8.startsWith(p)) continue;
      const chave = a[1] + '|' + a[3] + '|' + a[4];
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      out.push({ prefixo: p, orgao: a[1], ta: a[2], modelo: a[3], tipo: a[4], impedimento: a[5] });
    }
    out.sort((x, y) => y.prefixo.length - x.prefixo.length);
    return out;
  }

  /* ---------------- risco consolidado ---------------- */
  function risco(ncm8, opcoes) {
    opcoes = opcoes || {};
    const it = porNcm.get(ncm8) || null;
    const ta = regrasTA(ncm8, opcoes.cond || 'novo');
    const lpco = regrasLPCO(ncm8);
    const textoBusca = [opcoes.texto || '', it ? it.desc : '', it ? it.path : ''].join(' ');
    const ad = medidasAD(textoBusca, ncm8);

    const orgaos = Array.from(new Set(ta.map(r => r.orgao).filter(Boolean)));
    const adAtivo = ad.filter(m => !m.susp);

    /* Regra condicional ("País/NCM", "NCM/Destaque") só vale se a origem ou o
       destaque declarado baterem. Um embargo de capítulo inteiro por país não
       pode gritar "operação impedida" num produto chinês qualquer — isso
       queimaria a confiança no alerta justamente onde ele precisa ser levado
       a sério. Então entra como "verificar", não como bloqueio.              */
    const diretas = ta.filter(r => !r.condicional);
    const condicionais = ta.filter(r => r.condicional);
    const maxNivel = diretas.reduce((m, r) => Math.max(m, r.nivel), 0);
    const maxCond = condicionais.reduce((m, r) => Math.max(m, r.nivel), 0);

    let nivel = 'ok', rotulo = 'Sem barreira identificada';
    if (adAtivo.length)        { nivel = 'bad';  rotulo = 'Antidumping possível'; }
    else if (maxNivel >= 4)    { nivel = 'bad';  rotulo = 'Operação impedida'; }
    else if (maxNivel === 3)   { nivel = 'mid';  rotulo = 'Licença prévia (não-automática)'; }
    else if (maxNivel === 2)   { nivel = 'warn'; rotulo = 'Licenciamento automático'; }
    else if (ad.length)        { nivel = 'warn'; rotulo = 'Antidumping suspenso — verificar'; }
    else if (maxCond >= 3)     { nivel = 'warn'; rotulo = 'Pode exigir licença — verificar destaque/origem'; }
    else if (lpco.length)      { nivel = 'warn'; rotulo = 'Tem LPCO no Portal Único'; }

    return { ncm: ncm8, item: it, ta, lpco, antidumping: ad, orgaos, nivel, rotulo, maxNivel, maxCond };
  }

  /* ---------------- acesso ---------------- */
  return {
    carregar, buscar, risco, medidasAD, regrasTA, regrasLPCO,
    item: (ncm) => porNcm.get(ncm) || null,
    itensPorPrefixo: (p) => itens.filter(it => it.ncm.startsWith(p)),
    capitulo: (c) => capitulos[c] || '',
    orgaoNome: (sigla) => (anuencia && anuencia.orgaos && anuencia.orgaos[sigla]) || sigla,
    totalItens: () => itens.length,
    meta: () => ({
      fiscal: fiscal && fiscal.meta, anuencia: anuencia && anuencia.meta,
      antidumping: antidumping && antidumping.meta
    }),
    adChina: () => adChina.slice(),
    norm, toks
  };
})();

/* ---------------- ICMS por UF (editável no app) ----------------
   Alíquota interna modal. Confirme a sua: vários estados alteraram
   em 2025/2026 e há regimes especiais de importação por UF.        */
const UF_ICMS = {
  AC:19, AL:20, AM:20, AP:18, BA:20.5, CE:20, DF:20, ES:17, GO:19, MA:23,
  MT:17, MS:17, MG:18, PA:19, PB:20, PR:19.5, PE:20.5, PI:22.5, RJ:22,
  RN:20, RS:17, RO:19.5, RR:20, SC:17, SE:22, SP:18, TO:20
};
