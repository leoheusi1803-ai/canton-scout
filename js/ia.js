/* ============================================================
   ia.js — leitura do cartão do fornecedor e do áudio, pela IA.

   Só funciona com internet, e nunca é obrigatória: a foto do cartão e o
   áudio ficam gravados no aparelho de qualquer jeito. A IA só poupa a
   digitação — e o que ela devolve vai para os campos, onde a pessoa vê
   e corrige antes de salvar.

   Passa pelo n8n da Heusi, que guarda a chave da OpenAI: a chave nunca
   fica no celular nem no repositório, que é público. O código da viagem
   vai junto e é conferido lá — sem ele o n8n não chama a IA, então quem
   achar este endereço no código não gasta os créditos.
   ============================================================ */
const IA = (() => {
  const URL_IA = 'https://n8nv2-n8n.5hfq7e.easypanel.host/webhook/canton-scout-ia';
  const TEMPO = 60000;

  function comoDataUrl(blob) {
    return new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = () => erro(new Error('não consegui ler o arquivo'));
      fr.readAsDataURL(blob);
    });
  }

  function chamar(corpo) {
    return Promise.race([
      fetch(URL_IA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
      }),
      new Promise((_, erro) => setTimeout(() => erro(new Error('a IA demorou demais')), TEMPO))
    ])
      .catch(e => {
        if (e && e.message === 'a IA demorou demais') throw e;
        throw new Error('sem conexão com a IA (internet ou VPN)');
      })
      .then(r => r.json().catch(() => ({})).then(j => {
        if (!r.ok || !j.ok) throw new Error(j.erro || ('a IA respondeu ' + r.status));
        return j;
      }));
  }

  /* devolve { empresa, nome, cargo, wechat, whatsapp, telefone, email, site, endereco, estande } */
  function lerCartao(blob, viagem) {
    return comoDataUrl(blob).then(imagem => chamar({ tipo: 'cartao', viagem, imagem }));
  }

  /* devolve { transcricao, nome, descricao, preco, moeda, moq, quantidade, peso_kg, cbm, observacoes } */
  function lerAudio(blob, viagem) {
    return comoDataUrl(blob).then(audio => chamar({ tipo: 'audio', viagem, audio }));
  }

  return { lerCartao, lerAudio };
})();
