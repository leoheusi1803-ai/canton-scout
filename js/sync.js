/* ============================================================
   sync.js — sincronização entre os celulares da viagem.

   OPORTUNISTA, nunca obrigatória. O app funciona inteiro sem rede;
   quando houver internet (VPN, eSIM, WiFi do hotel), ele empurra o que
   é novo e puxa o que os outros cadastraram. Se a conexão cair no meio,
   nada quebra: o que não subiu sobe na próxima.

   Só vão os DADOS e uma miniatura de cada produto. As fotos inteiras são
   95% do peso e continuam indo por AirDrop, que não precisa de rede.

   A chave abaixo é publicável e o repositório é público, então ela é
   visível de propósito. Quem protege os dados é o CÓDIGO DA VIAGEM:
   sem ele, o banco não devolve uma linha sequer (RLS no servidor).

   Como cada rodada decide o que trocar: compara a lista do servidor
   (só id e versão de cada produto, poucos KB) com a do aparelho.
   O que falta ou está mais velho de um lado vai para o outro.
   Até a v19 era "o que mudou depois do último recebido", pela hora do
   cadastro — e produto feito sem sinal no pavilhão, enviado horas depois
   com hora antiga, era pulado para sempre pelos outros celulares.
   Comparar a lista inteira não depende de relógio nem de ordem de envio,
   e se corrige sozinho: o que falhou numa rodada aparece na próxima.
   ============================================================ */
const SYNC = (() => {
  const URL_BASE = 'https://biqdkweqikorbvemfxrp.supabase.co/rest/v1/canton_produtos';
  const CHAVE = 'sb_publishable_nxQ14IRFnT0Fem9cGNCkiw_73H-J15d';
  const LOTE_ENVIO = 20;     // com miniatura, ~25 KB por produto
  const LOTE_BUSCA = 40;     // ids por consulta, cabe folgado na URL

  let viagem = '';
  let dispositivo = '';
  let ultimo = null;        // resultado da última tentativa
  let rodando = false;

  /* O código é um segredo combinado, não um texto: maiúscula automática,
     espaço ou corretor num dos três celulares não podem separar a viagem. */
  function normalizar(codigo) {
    return (codigo || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  function configurar(codigoViagem, nomeDispositivo) {
    viagem = normalizar(codigoViagem);
    dispositivo = (nomeDispositivo || '').trim() || 'sem nome';
  }
  function ativo() { return !!viagem; }
  function estado() { return ultimo; }
  function codigo() { return viagem; }

  function cabecalhos(extra) {
    return Object.assign({
      'apikey': CHAVE,
      'Authorization': 'Bearer ' + CHAVE,
      'x-viagem': viagem,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  /* o que viaja é o produto como está no aparelho, menos o controle local.
     Produto sem autor foi cadastrado AQUI: os recebidos sempre ganham o
     autor ao chegar. */
  function paraEnvio(p) {
    const d = Object.assign({}, p);
    delete d.id;
    delete d.sincAt;
    if (!d.autor) d.autor = dispositivo;
    return d;
  }

  function comTempo(promessa, ms) {
    return Promise.race([
      promessa,
      new Promise((_, erro) => setTimeout(() => erro(new Error('tempo esgotado')), ms || 20000))
    ]);
  }

  /* "Failed to fetch" não diz nada a quem está no estande */
  function pedir(url, opcoes) {
    return comTempo(fetch(url, Object.assign({ headers: cabecalhos() }, opcoes || {})))
      .catch(e => {
        if (e && e.message === 'tempo esgotado') throw e;
        throw new Error('sem conexão com o servidor (internet ou VPN)');
      })
      .then(r => {
        if (r.ok) return r;
        return r.text().then(t => { throw new Error('servidor respondeu ' + r.status + ': ' + t.slice(0, 120)); });
      });
  }

  const ms = (iso) => new Date(iso).getTime();

  function pedacos(lista, n) {
    const out = [];
    for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
    return out;
  }

  /* id, versão e se está apagado, de todos os produtos da viagem.
     Em páginas até vir uma vazia: o servidor corta cada resposta num
     máximo de linhas, e uma lista cortada faria produto "sumir". */
  function listarServidor() {
    const pagina = (depois, acc) =>
      pedir(URL_BASE + '?select=id,atualizado,apagado&order=id.asc&limit=1000'
        + (depois ? '&id=gt.' + encodeURIComponent(depois) : ''))
        .then(r => r.json())
        .then(linhas => linhas.length
          ? pagina(linhas[linhas.length - 1].id, acc.concat(linhas))
          : acc);
    return pagina('', []);
  }

  function enviar(itens) {
    const linhas = itens.map(p => ({
      id: p.id,
      viagem: viagem,
      dispositivo: dispositivo,
      dados: paraEnvio(p),
      apagado: !!p.apagado,
      atualizado: new Date(p.atualizado || p.criado || Date.now()).toISOString()
    }));
    return pedacos(linhas, LOTE_ENVIO).reduce((fila, lote) => fila.then(() =>
      pedir(URL_BASE + '?on_conflict=id', {
        method: 'POST',
        headers: cabecalhos({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(lote)
      })), Promise.resolve());
  }

  function buscar(ids) {
    return pedacos(ids, LOTE_BUSCA).reduce((fila, lote) => fila.then(acc =>
      pedir(URL_BASE + '?select=id,dados,apagado,atualizado,dispositivo&id=in.('
        + lote.map(encodeURIComponent).join(',') + ')')
        .then(r => r.json()).then(linhas => acc.concat(linhas))), Promise.resolve([]));
  }

  /* Uma rodada completa. Nunca lança: devolve sempre um relatório.

     produtos  os do aparelho (sem os apagados)
     apagados  [{id, atualizado}] apagados AQUI de produtos cadastrados aqui:
               sobem como "apagado" e somem dos outros celulares
     ignorar   ids que este aparelho apagou ou escondeu: não voltam
     aplicar   grava o que chegou; devolve quantos mudaram             */
  function sincronizar(produtos, apagados, ignorar, aplicar) {
    if (!ativo()) return Promise.resolve({ ok: false, motivo: 'sem código de viagem' });
    if (!navigator.onLine) {
      ultimo = { ok: false, motivo: 'sem internet agora', quando: Date.now() };
      return Promise.resolve(ultimo);
    }
    if (rodando) return Promise.resolve({ ok: false, motivo: 'já sincronizando' });
    rodando = true;
    const t0 = Date.now();
    let enviados = 0;
    let servidor = new Map();

    return listarServidor()
      .then(lista => {
        servidor = new Map(lista.map(r => [r.id, { t: ms(r.atualizado), apagado: r.apagado }]));
        const maisNovo = (p) => {
          const s = servidor.get(p.id);
          return !s || (p.atualizado || p.criado || 0) > s.t;
        };
        // produto recebido e não mexido aqui não volta: quem manda é o autor
        const envio = produtos.filter(p => p.sincAt !== p.atualizado && maisNovo(p))
          .concat(apagados.filter(maisNovo).map(a => ({ id: a.id, atualizado: a.atualizado, apagado: true })));
        enviados = envio.length;
        return enviar(envio).then(() => {
          envio.forEach(p => servidor.set(p.id, { t: p.atualizado || p.criado, apagado: !!p.apagado }));
          const local = new Map(produtos.map(p => [p.id, p.atualizado || p.criado || 0]));
          const faltam = lista.filter(r => {
            if (ignorar.has(r.id)) return false;
            const l = local.get(r.id);
            return l === undefined ? !r.apagado : ms(r.atualizado) > l;
          });
          // apagado não precisa do produto inteiro para ser aplicado
          const apagadosLa = faltam.filter(r => r.apagado);
          return buscar(faltam.filter(r => !r.apagado).map(r => r.id))
            .then(linhas => aplicar(apagadosLa.concat(linhas)));
        });
      })
      .then(recebidos => {
        ultimo = { ok: true, enviados, recebidos, quando: Date.now(), ms: Date.now() - t0, servidor };
        return ultimo;
      })
      .catch(e => {
        ultimo = { ok: false, motivo: e.message || String(e), quando: Date.now() };
        return ultimo;
      })
      .then(r => { rodando = false; return r; });
  }

  return { configurar, ativo, estado, codigo, normalizar, sincronizar };
})();
