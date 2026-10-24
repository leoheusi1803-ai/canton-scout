# Canton Scout

Ferramenta de campo para a Canton Fair: classificação fiscal NCM, barreiras
administrativas (órgãos anuentes / LPCO), medidas antidumping contra a China e
previsão de custo landed de importação.

**Funciona 100% offline.** Foi feito assim de propósito: na China o WiFi do
pavilhão e os chips locais ficam atrás do Great Firewall, que bloqueia as APIs
de IA, o Google e quase tudo que um app de nuvem precisaria. Toda a base está
gravada no aparelho.

---

## O que tem dentro

| Dado | Registros | Fonte oficial |
|---|---:|---|
| NCM + Imposto de Importação | 10.516 | TEC — Res. Gecex 272/2021, atualizada até a Res. Gecex 926, de 24/06/2026 (Anexos I e II) |
| IPI | 10.521 | TIPI — Decreto 11.158/2022, atualizado até o ADE RFB nº 1, de 30/01/2026 |
| Tratamento administrativo | 5.288 regras | Siscomex — Tratamento Administrativo na Importação (Anuente Web) |
| LPCO / DUIMP | 34.444 regras | Siscomex — Portal Único |
| Órgãos anuentes | 18 | idem |
| Antidumping em vigor | 94 medidas (60 envolvem a China) | MDIC/SECEX — DECOM, medidas em vigor |

Baixado em **13/10/2026**. Total: ~7 MB no aparelho.

## Como as três pessoas usam

**A foto** — ao fotografar, um MobileNet V2 roda DENTRO do aparelho (15 MB
embarcados, zero rede) e sugere o produto. Um toque na sugestão e o app já
vai para a pergunta de material. Nos testes acertou 89% das vezes em que
sugeriu, e preferiu calar em 44% das imagens — sugerir com pouca confiança
seria pior que não sugerir, porque a pessoa toca no primeiro item e leva uma
NCM errada. Abaixo de 20% de confiança ele assume que não sabe.

**Quem não sabe comex (modo Guiado)** — categoria → produto → material. Três
toques e sai NCM, imposto, alerta de barreira em português claro e custo por
peça. São 126 produtos das Fases 2 e 3, com 305 variações de material, todos
com o código conferido contra a tabela oficial. Quando o código ainda tem
subdivisões, o app desce na árvore da NCM e usa o texto da própria Receita
como pergunta. O que não estiver no dicionário vira "marcar para o Leonardo" —
o app não chuta.

**Quem sabe comex (modo Buscar por texto)** — busca livre em português ou
inglês sobre os 10.516 códigos, com os candidatos ranqueados.

## As cinco telas

- **Capturar** — foto pela câmera nativa, preço FOB, MOQ, peso, CBM, estande,
  WeChat do fornecedor. Salva na hora, sem rede. As fotos são reduzidas para
  1280 px antes de gravar, senão 50 produtos encheriam o celular.
  **Foto do cartão** do fornecedor (vale como contato) e **áudio** falando
  preço e detalhes: os dois ficam no produto mesmo sem rede. Com internet, a
  IA lê o cartão (fabricante, WeChat, telefone, estande) e transcreve o áudio
  (preço, MOQ, detalhes) direto nos campos. Sem rede, dá para ler depois no
  produto, pelos botões "Ler cartão" e "Transcrever áudio".
  **Foto da placa do estande**: a IA lê o número (ex.: 11.2 K23) e o nome da
  empresa e preenche "Nº do estande" e "Fabricante". Placa de outro estande
  apaga o contato que sobrou do fornecedor anterior (um toque desfaz). A foto
  fica no produto; sem rede, dá para ler depois pelo botão "Ler placa".
  **NCM pela IA**: com internet, a foto do produto já volta com até três NCM
  sugeridas (texto oficial, II, IPI e risco); a escolhida vai junto ao salvar.
  No produto salvo, o botão "Classificar NCM com IA" faz o mesmo — inclusive
  nos produtos dos outros celulares, pela miniatura.
- **Produtos** — lista com o selo de risco e o custo por peça já calculado.
  Ordena por pior risco ou menor custo. Exporta backup (.json, com as fotos)
  e planilha (.csv, abre no Excel).
- **NCM** — busca por descrição em **português ou inglês** (os estandes
  atendem em inglês). Mostra II, IPI e o risco de cada candidato.
- **Custos** — extrato linha a linha, com a base de cálculo de cada tributo.
- **Config** — câmbio, UF/ICMS, regime tributário, modal, frete, despesas.
  E o **teste de modo offline**.

## Sincronização entre os celulares

Mesmo **código da viagem** em Config nos três celulares (maiúscula e espaço
não importam) e o nome de quem usa cada um. Com internet, cada celular compara
a lista do servidor (Supabase, tabela `canton_produtos`) com a dele e troca o
que falta — inclusive o que foi cadastrado sem sinal e enviado horas depois.
Viajam os dados e uma miniatura de cada produto; as fotos inteiras, o cartão, a
placa e o áudio ficam no celular de quem cadastrou (vão pelo backup/AirDrop). Apagar
um produto que você cadastrou some dos três; o de outra pessoa sai só do seu.
Sem código, o topo mostra **sem sync** e nada sai do aparelho.

## Leitura do cartão e do áudio (IA)

O app chama o fluxo **Canton Scout - Ler Cartão e Áudio** no n8n da Heusi
(`/webhook/canton-scout-ia`), que guarda a chave da OpenAI — a chave nunca vai
para o celular nem para este repositório. Cartão e placa do estande: GPT-4o com visão.
Áudio: Whisper transcreve e o GPT-4o mini separa preço, MOQ e detalhes. O fluxo só
atende quem manda o código da viagem certo; **se trocarem o código, troque
também no nó "Conferir e Preparar"** do fluxo.

## Classificação da NCM pela IA

O reconhecimento no aparelho (MobileNet) conhece mil objetos genéricos e o
modo Guiado tem um dicionário de utilidades; banheira, vaso sanitário, sauna,
casa pré-fabricada ou painel de PVC caíam em "Não reconheci". Com internet, o
app chama o fluxo **Canton Scout - Classificar NCM** no n8n
(`/webhook/canton-scout-ncm`), em duas etapas:

1. O GPT-4o olha a foto e o que foi anotado e propõe até três posições (4
   dígitos), com o motivo e o que confirmar com o fornecedor (o material,
   quase sempre).
2. O app pega na tabela oficial que está no aparelho **todos os itens** de
   cada posição e a IA escolhe entre esses textos. Assim o código final sempre
   existe e bate com a descrição — de cabeça, a IA errava o fim do código
   (8516.79.10 é "Panelas", não toalheiro elétrico).

É sugestão: quem toca escolhe, e o produto fica marcado com "🤖 IA" na lista e
na planilha até alguém atribuir a NCM pelo modo Guiado ou pela busca. O fluxo
confere o mesmo código da viagem do fluxo do cartão.

## Antes de embarcar — faça nesta ordem

1. Hospede a pasta num endereço **https** (veja abaixo).
2. Abra esse endereço **no celular**, no Chrome (Android) ou Safari (iPhone).
3. Menu do navegador → **Adicionar à tela de início**. Isso instala o app.
4. Abra pelo ícone da tela inicial e espere a barra de carregamento terminar.
5. **Config → Testar modo offline.** Tem que dar verde nos três itens.
6. Confirmação de verdade: **ative o modo avião**, feche o app e abra de novo.
   Se abrir normal e a busca de NCM funcionar, está pronto.
7. Em Config, preencha o **câmbio do dia** e a **UF/ICMS** de vocês.
8. Repita nos outros celulares e no notebook.

> Depois de embarcar eu não consigo mais atualizar nada. O que estiver no
> aparelho no momento do embarque é o que vocês vão ter na feira.

## Hospedagem (passo 1)

O app é só arquivo estático, não precisa de servidor de aplicação. Qualquer
uma destas serve:

- **GitHub Pages** — crie um repositório, suba a pasta, ative Pages em
  Settings → Pages. Endereço fica `https://<usuario>.github.io/<repo>/`.
- **Netlify / Cloudflare Pages / Vercel** — arrastar a pasta já publica.

**Precisa ser https.** Service worker e instalação de PWA não funcionam em
`http://` (exceto `localhost`) nem abrindo o arquivo direto do disco.

### Rodar no notebook, sem hospedar

```bash
powershell -ExecutionPolicy Bypass -File "build\serve.ps1" 8099
```

Depois abra `http://localhost:8099/`. Serve para testar e para usar no
próprio notebook — `localhost` conta como contexto seguro.

## Atualizar a base antes da viagem

Os três extratores releem as planilhas oficiais e regeram os `.json`.
Precisam do Excel instalado (usam COM, não precisam de Python nem Node):

```bash
powershell -ExecutionPolicy Bypass -File "build\extract-fiscal.ps1"
```

`build/extract-anuencia.ps1` e `build/extract-antidumping.ps1` fazem o mesmo
para as outras duas bases. Depois de regerar, suba de novo e **force o
recarregamento no celular** (o service worker guarda a versão antiga).

---

## Limitações — leia antes de confiar

- **A busca sugere candidatos, não classifica sozinha.** Ela não substitui a
  aplicação das RGI/RGC. Para pedido grande, confirme com o despachante ou
  peça uma Consulta de Classificação Fiscal à Receita.
- **O antidumping não é casado por NCM na fonte oficial.** A tabela do DECOM
  traz produto/origem/prazo, sem NCM. As posições foram mapeadas à mão
  (`AD_NCM`, em `js/dados.js`) para 36 das 60 medidas que envolvem a China —
  é triagem, não escopo legal. O escopo real está na Resolução Gecex de cada
  medida. Quando a medida bate só por semelhança de nome, o app avisa.
- **ICMS: SC, 17%, sem benefício** — confirmado como alíquota interna de SC em
  2026. Se vocês optarem por TTD 409/410/411 no futuro, a carga cai muito e a
  conta muda: me avisem para reconfigurar.
- **Crédito de ICMS nem sempre vira dinheiro.** Revenda interestadual de
  mercadoria importada sai a 4% (Res. Senado 13/2012), contra 17% pagos no
  desembaraço. O app estima o débito da venda e abate só a parte do crédito que
  ela absorve; o resto aparece como "ICMS que fica acumulado".
- **CBS/IBS estão em transição.** 2026 é ano-teste (0,9% + 0,1%, compensáveis
  contra PIS/COFINS). A base de cálculo na importação ainda está sendo
  regulamentada — o app usa VA + II + IPI como aproximação e avisa disso.
- **Frete e despesas locais são o que vocês colocarem.** O app não cota nada.
- **Não cobre**: ex-tarifário, acordos preferenciais (irrelevante para a China,
  que não tem acordo com o Mercosul), drawback, valoração aduaneira especial,
  nem a certificação compulsória INMETRO em si (só aponta que o INMETRO é
  anuente daquela NCM).

## Estrutura

```
index.html              tela única, cinco abas
app.css
js/db.js                IndexedDB: produtos, fotos, config
js/dados.js             base fiscal, busca NCM, motor de risco
js/custos.js            cálculo de custo landed
js/ui.js                telas e amarração
sw.js                   service worker — é o que faz abrir offline
data/fiscal.json        NCM + II + IPI          (3,0 MB)
data/anuencia.json      anuentes + LPCO         (4,1 MB)
data/antidumping.json   medidas em vigor        ( 11 KB)
build/                  extratores e servidor local
```

---

## Publicar no GitHub Pages

A pasta já está pronta para ser servida em subpasta
(`usuario.github.io/canton-scout/`) — isso foi testado: todos os caminhos são
relativos e o escopo do service worker resolve certo. O `.nojekyll` evita que
o GitHub processe os arquivos.

1. Crie um repositório em <https://github.com/new>. Nome sugerido:
   `canton-scout`. Pode ser **público ou privado** — o Pages funciona nos dois
   em conta paga; em conta gratuita, o Pages exige repositório **público**.
2. No terminal, dentro desta pasta:

```bash
git remote add origin https://github.com/SEU-USUARIO/canton-scout.git
git branch -M main
git push -u origin main
```

3. No repositório: **Settings → Pages → Source: Deploy from a branch →
   branch `main`, pasta `/ (root)` → Save.**
4. Espere 1 a 2 minutos. O endereço aparece na mesma tela, no formato
   `https://SEU-USUARIO.github.io/canton-scout/`.
5. Abra esse endereço no celular e siga o checklist "Antes de embarcar".

Se o push pedir senha: o GitHub não aceita mais senha de conta. Gere um token
em **Settings → Developer settings → Personal access tokens → Tokens
(classic)**, marque o escopo `repo`, e use o token no lugar da senha.
