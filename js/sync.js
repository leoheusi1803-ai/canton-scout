/* ============================================================
   sync.js — sincronização entre os celulares da viagem.

   OPORTUNISTA, nunca obrigatória. O app funciona inteiro sem rede;
   quando houver internet (VPN, eSIM, WiFi do hotel), ele empurra o que
   é novo e puxa o que os outros cadastraram. Se a conexão cair no meio,
   nada quebra: o que não subiu sobe na próxima.

   Só vão os DADOS, não as fotos. Texto de 50 produtos são poucos KB e
   passam até em conexão ruim; as fotos são 95% do peso e continuam indo
   por AirDrop, que não precisa de rede nenhuma.

   A chave abaixo é publicável e o repositório é público, então ela é
   visível de propósito. Quem protege os dados é o CÓDIGO DA VIAGEM:
   sem ele, o banco não devolve uma linha sequer (RLS no servidor).
   ============================================================ */
const SYNC = (() => {
  const URL_BASE = 'https://biqdkweqikorbvemfxrp.supabase.co/rest/v1/canton_produtos';
  const CHAVE = 'sb_publishable_nxQ14IRFnT0Fem9cGNCkiw_73H-J15d';

  let viagem = '';
  let dispositivo = '';
  let ultimo = null;        // resultado da última tentativa
  let rodando = false;

  function configurar(codigoViagem, nomeDispositivo) {
    viagem = (codigoViagem || '').trim();
    dispositivo = (nomeDispositivo || '').trim() || 'sem nome';
  }
  function ativo() { return !!viagem; }
  function estado() { return ultimo; }

  function cabecalhos(extra) {
    return Object.assign({
      'apikey': CHAVE,
      'Authorization': 'Bearer ' + CHAVE,
      'x-viagem': viagem,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  /* corta o que não deve viajar: foto é pesada e vai por AirDrop */
  function paraEnvio(p) {
    const d = Object.assign({}, p);
    delete d.id;
    return d;
  }

  function comTempo(promessa, ms) {
    return Promise.race([
      promessa,
      new Promise((_, erro) => setTimeout(() => erro(new Error('tempo esgotado')), ms || 12000))
    ]);
  }

  /* Empurra os produtos alterados depois do último envio bem-sucedido. */
  function enviar(produtos, desde) {
    const novos = produtos.filter(p => (p.atualizado || p.criado || 0) > desde);
    if (!novos.length) return Promise.resolve(0);
    const linhas = novos.map(p => ({
      id: p.id,
      viagem: viagem,
      dispositivo: dispositivo,
      dados: paraEnvio(p),
      apagado: !!p.apagado,
      atualizado: new Date(p.atualizado || p.criado || Date.now()).toISOString()
    }));
    return comTempo(fetch(URL_BASE + '?on_conflict=id', {
      method: 'POST',
      headers: cabecalhos({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(linhas)
    })).then(r => {
      if (!r.ok) return r.text().then(t => { throw new Error('envio ' + r.status + ': ' + t.slice(0, 120)); });
      return novos.length;
    });
  }

  /* Puxa o que mudou no servidor depois da última sincronização. */
  function receber(desde) {
    const iso = new Date(desde || 0).toISOString();
    const url = URL_BASE + '?select=id,dados,apagado,atualizado,dispositivo'
      + '&atualizado=gt.' + encodeURIComponent(iso) + '&order=atualizado.asc&limit=1000';
    return comTempo(fetch(url, { headers: cabecalhos() })).then(r => {
      if (!r.ok) return r.text().then(t => { throw new Error('leitura ' + r.status + ': ' + t.slice(0, 120)); });
      return r.json();
    });
  }

  /* Uma rodada completa. Nunca lança: devolve sempre um relatório. */
  function sincronizar(produtos, desde, aplicar) {
    if (!ativo()) return Promise.resolve({ ok: false, motivo: 'sem código de viagem' });
    if (!navigator.onLine) return Promise.resolve({ ok: false, motivo: 'sem internet' });
    if (rodando) return Promise.resolve({ ok: false, motivo: 'já sincronizando' });
    rodando = true;
    const t0 = Date.now();
    let enviados = 0;

    return enviar(produtos, desde)
      .then(n => { enviados = n; return receber(desde); })
      .then(linhas => aplicar(linhas).then(recebidos => {
        ultimo = {
          ok: true, enviados, recebidos, quando: Date.now(),
          ms: Date.now() - t0,
          // marca de corte: a hora do servidor da última linha, ou agora
          corte: linhas.length ? new Date(linhas[linhas.length - 1].atualizado).getTime() : Date.now()
        };
        return ultimo;
      }))
      .catch(e => {
        ultimo = { ok: false, motivo: e.message || String(e), quando: Date.now() };
        return ultimo;
      })
      .then(r => { rodando = false; return r; });
  }

  return { configurar, ativo, estado, sincronizar };
})();
