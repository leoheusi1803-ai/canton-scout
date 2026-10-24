/* ============================================================
   ia.js — leitura do cartão do fornecedor, do áudio e da placa do
   estande, e a sugestão de NCM pela foto, pela IA.

   Só funciona com internet, e nunca é obrigatória: as fotos do cartão e
   da placa e o áudio ficam gravados no aparelho de qualquer jeito. A IA
   só poupa a digitação — e o que ela devolve vai para os campos, onde a
   pessoa vê e corrige antes de salvar.

   Passa pelo n8n da Heusi, que guarda a chave da OpenAI: a chave nunca
   fica no celular nem no repositório, que é público. O código da viagem
   vai junto e é conferido lá — sem ele o n8n não chama a IA, então quem
   achar este endereço no código não gasta os créditos.
   ============================================================ */
const IA = (() => {
  const URL_IA = 'https://n8nv2-n8n.5hfq7e.easypanel.host/webhook/canton-scout-ia';
  // fluxo à parte ("Canton Scout - Classificar NCM"): mexer nele não arrisca o do cartão
  const URL_NCM = 'https://n8nv2-n8n.5hfq7e.easypanel.host/webhook/canton-scout-ncm';
  const TEMPO = 60000;

  function comoDataUrl(blob) {
    return new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = () => erro(new Error('não consegui ler o arquivo'));
      fr.readAsDataURL(blob);
    });
  }

  function chamar(corpo, url) {
    return Promise.race([
      fetch(url || URL_IA, {
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

  /* devolve { estande, empresa, observacao } — estande no formato da feira, "11.2 K23" */
  function lerEstande(blob, viagem) {
    return comoDataUrl(blob).then(imagem => chamar({ tipo: 'estande', viagem, imagem }));
  }

  /* 1ª etapa da NCM: a IA olha a foto (Blob do aparelho ou data URL da
     miniatura sincronizada) e o que foi anotado.
     devolve { produto, descricao, candidatos: [{ ncm, motivo, confirmar }], observacao } */
  function classificarNcm(imagem, texto, viagem) {
    const foto = !imagem ? Promise.resolve('')
      : (typeof imagem === 'string' ? Promise.resolve(imagem) : comoDataUrl(imagem));
    return foto.then(img => chamar({ viagem, imagem: img, texto: texto || '' }, URL_NCM));
  }

  /* 2ª etapa: escolhe, entre os itens OFICIAIS que o app manda, o de cada posição.
     devolve { escolhas: [{ ncm, motivo }] } */
  function escolherItemNcm(dados, viagem) {
    return chamar(Object.assign({ etapa: 'item', viagem }, dados), URL_NCM);
  }

  return { lerCartao, lerAudio, lerEstande, classificarNcm, escolherItemNcm };
})();
