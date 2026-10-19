# Escolhas de código — app Baluarte

Roteiro para a apresentação: como as telas, os componentes e a estilização foram organizados, e por quê.

## 1. Estrutura de pastas

- **`screens/<Tela>/`** — cada tela só **compõe** componentes e cuida do próprio estado de formulário. Nenhuma regra de negócio mora na tela.
- **`components/<Componente>/`** — peças pequenas e reutilizáveis. Todas as que desenham algo seguem o mesmo par de arquivos: `index.tsx` (JSX e props tipadas) + `styles.ts` (`StyleSheet.create`). Quem abre uma pasta sabe onde está a aparência e onde está o comportamento. A única exceção é o `ToastOffset`, que não desenha nada (só informa ao toast onde aparecer).
- **`lib/`** — funções **puras** (sem React): formatação de datas pt-BR, validações, autenticação simulada/RBAC e regras de campanha. Por serem puras, são testadas sem renderizar nada.
- **`data/`** — os dados do produto web (usuários, campanhas, treinamentos, grupos, modelos). Os textos dos treinamentos foram copiados sem resumir de `mocks/data.ts` (57 textos, conferidos um a um por script).
- **`contexts/`** — estado global: sessão, campanhas, conclusão dos treinamentos e toast.
- **`theme/`** — tokens de cor, tipografia, espaçamento e ícones. Nenhuma tela escreve cor em hexadecimal.

## 2. Componentes

- **Controlados e sem estado escondido.** `TemplateSelect`, `GroupSelect`, `TextField` etc. recebem `value` e avisam mudanças por `onChange`/`onPress`; quem decide o que guardar é a tela.
- **Composição em vez de variações infinitas.** `TemplateSelect` só organiza a fileira; cada card é um `TemplateCard`. `CampaignListItem` usa `StatusPill` + `ListDivider`; `CampaignBanner` usa `StatusPill`, `KpiRow` e `BastionRings`.
- **Variantes explícitas.** `Button` tem `primary` (branco com texto ink), `outline` (contorno) e `success` (o "Concluído" verde). `StatusPill` tem `pill` (Detalhes, texto de 12 px) e `plain` (lista da Home, 13 px).
- **Acessibilidade no aparelho e no navegador.** Estados e valores vão em props ARIA, que o React Native converte no aparelho e o react-native-web escreve no HTML (o react-native-web 0.21 ignora `accessibilityState`/`accessibilityValue`, então essas props não serviam na web):
  - cards de modelo no formulário são `radio` com `aria-checked`; os grupos do modal também;
  - no filtro da Home o card é um botão de alternância: no aparelho, estado "selecionado"; no navegador, `aria-pressed` (o `aria-selected` não vale para `role="button"` e seria ignorado pelo leitor de tela);
  - a barra de progresso expõe `aria-valuemin/max/now/text` ("0%" → "100%"); o `Button` expõe `aria-disabled`;
  - erros são `alert`; botões só de ícone têm rótulo ("Nova campanha", "Mostrar senha").

## 3. Estado da seleção de modelo (a "troca de estado da categoria")

O mesmo componente atende às duas telas, com duas regras, escritas numa função pura (`components/TemplateSelect/selection.ts`):

```ts
nextTemplateSelection(mode, atual, tocado)
// 'filter' (Home):          toca seleciona; tocar de novo no mesmo LIMPA  -> null
// 'radio'  (Nova campanha): toca seleciona; tocar no selecionado MANTÉM
```

- **Home:** `const [template, setTemplate] = useState<TemplateId | null>(null)`. `null` = sem filtro. A lista e o "Total N" saem de `filterByTemplate(campaigns, template)` num `useMemo`.
- **Nova campanha:** o modelo é um campo do formulário, começa `null` ("Selecione um modelo."). A descrição embaixo dos cards é **derivada** do estado (`getTemplate(template).description`), não um segundo estado — assim nunca fica dessincronizada.
- **Visual por estado:** selecionado = borda branca de 2 px + fundo `#1F2738` + rádio cheio com ponto ink; não selecionado = borda `#26324A`, ícone/rótulo `#8E9DB5`, rádio vazado `#3C4B63`.
- **Sem "pulo" ao selecionar:** a borda que ocupa espaço é sempre de 1 px; o destaque de 2 px é um contorno desenhado por cima (`selectionRing`, posição absoluta). Assim o card selecionado tem o mesmo tamanho dos outros, como na captura 20, e os vizinhos não se mexem a cada toque.

## 4. Tokens e estilização

- **Tese do DESIGN.md: "a única cor cromática da interface é o risco".** Botões, links e seleção são monocromáticos (branco/ink); cor só aparece em status de campanha, etapa do destinatário, erro e sucesso.
- `theme/colors.ts` nomeia por **papel** (`bg.page`, `bg.surface`, `border.input`, `text.secondary`…) e traz os mapas `campaignStatusTone` e `recipientStageTone` (fundo/borda/ponto/texto de cada status/etapa).
- `theme/typography.ts` define estilos por papel (`heroTitle`, `campaignName`, `numeral`, `caps`, `mono`…). Display = Archivo 500/700/800; corpo = IBM Plex Sans 400/500/600; dados (e-mails) = IBM Plex Mono. Com fonte customizada não se usa `fontWeight`: cada peso é uma família.
  - Tamanhos medidos nas capturas: `badge` (12 px, pílula de status dos Detalhes), `caption` (12 px, "Agendada para…" e "Somente @empresa.com"), `lead` (14/21, resumo do treinamento) e `paragraph` (13/20, corpo dos cartões do treinamento).
  - Exemplo de por que 1 px importa: com 13 px, "Agendada para 18/10/2026 09:00" precisava de 201 px e cabiam 199 na largura de 375, então o horário era cortado. Com 12 px (como na captura) a linha tem 186 px e cabe inteira em 360 e 375; em telas mais estreitas ela desce para a linha de baixo (`flexWrap`), nunca é cortada.
- `theme/spacing.ts` tem a escala de 4 em 4 (8, 12, 16, 20, 24, 32), os raios (8 inputs/botões, 12 cartões, 16 modais) e as medidas fixas do protótipo (botão 48, input 44, bloco 64, avatar 48, cabeçalho 60).
- **Sem números mágicos:** as poucas medidas do protótipo que ficam fora da escala são constantes com nome e origem no `styles.ts` do componente, por exemplo `RADIO_OFFSET = 10 - BORDER` (rádio a 10 px da borda externa), `HEADER_HEIGHT - ROW_BORDER` no modal de grupo-alvo, `dividerSpacing` da lista (passo de 96 px: bloco 64 + 19 + divisória 1 + 12), `DATE_SEPARATOR_WIDTH` e `OPTICAL_CENTER_PADDING`.
- Medidas conferidas contra as capturas 375×812: exportei a versão web, abri no Chrome em 375×812 (e em 360 e 320) e comparei cada tela com `docs/referencias`.
- **Bundle enxuto:** ícones Lucide importados um a um (`lucide-react-native/icons/alarm-clock`) e fontes por peso (`@expo-google-fonts/archivo/700Bold`) — o barril do Lucide traria ~1.600 ícones.

## 5. Navegação

- `@react-navigation/native` + `native-stack`, com **duas pilhas trocadas pela sessão** (`routes/index.tsx`): sem usuário existem só `Login → ResetPassword → ResetSent`; com usuário, só `Home → NewCampaign / CampaignDetails → Training`. Depois de entrar, o gesto de voltar não leva ao login.
- **Agendar** usa `navigation.replace('CampaignDetails', …)`: a Nova campanha sai da pilha e o "voltar" dos Detalhes cai na Home, que já mostra a campanha nova e "Total 6".
- **Enviar link de redefinição** usa `navigation.replace('ResetSent')`: a pilha fica Login → Solicitação enviada, então qualquer "voltar" (gesto do iOS, botão do Android, botão do navegador) leva ao Login, e não de volta ao formulário. O botão **Voltar ao login** usa `navigation.reset(...)` (limpa a pilha).
- Parâmetros tipados em `types/navigation.ts` (`AppScreenProps<'CampaignDetails'>` sabe que `route.params.campaignId` é `string`).
- **Na web** (`routes/linking.ts`, ligado só quando `Platform.OS === 'web'`): cada tela tem URL em português (`/campanhas`, `/campanhas/nova`, `/campanhas/camp-001`, `/treinamentos/trn-urgency`, `/redefinir-senha`…) e entra no histórico, então o botão Voltar do navegador volta dentro do app em vez de sair dele. Parâmetros fora do caminho não viram query string: o e-mail que o Login passa para a redefinição não aparece na URL. A aba mostra o título da tela ("Nova campanha · Baluarte", do `title` de cada `Stack.Screen`) e o HTML sai com `lang="pt-BR"` (`web.lang` no `app.json`). Como a sessão fica só em memória, recarregar a página mostra o Login; depois de entrar, o app reabre a tela da URL. Uma tela aberta direto pela URL sempre ganha a tela de base embaixo (Home para as internas, Login para a redefinição), então o "voltar" nunca fica sem destino; id desconhecido na URL mostra "Campanha/Treinamento não encontrado" com "Voltar para campanhas".
- O **toast** mora num provider acima da navegação: continua visível quando a tela troca e some sozinho em 2,5 s. **Onde ele aparece** é a tela em foco que informa, pelo componente `ToastOffset` (não desenha nada): o `Header` informa a altura do cabeçalho e a Home, que não tem cabeçalho, informa a altura da saudação. Sem informação, ele fica logo abaixo da área segura. O aviso não tem ações, então não bloqueia toques (`pointerEvents: 'none'`).

## 6. Validações

Todas em `lib/validation.ts`, puras e com as mensagens do produto web:

- **Login/Redefinir:** "E-mail é obrigatório", "Formato de e-mail inválido", "Senha é obrigatória", "A senha deve ter ao menos 6 caracteres.".
- **Nova campanha:** nome 3–80 caracteres; modelo obrigatório; data/hora montada dos 4 campos, precisa existir (31/02 é recusado: "Informe uma data e hora válidas.") e ser futura ("Informe uma data e hora futuras."); destinatários separados por linha, vírgula ou ponto e vírgula, sem repetidos, com "Informe ao menos um destinatário.", "E-mail inválido: {x}" e "Somente destinatários @empresa.com: {x}".
- O ano não é digitado: vale a **próxima ocorrência do mês**. Mês anterior ao atual é do ano seguinte (em 23/09, "15/01" = 15/01/2027; em 20/12, "02/02" = fevereiro do ano seguinte), então uma data futura nunca é recusada por falta do ano. O mês atual e os seguintes ficam no ano corrente: um dia que já passou neste mês continua recusado ("Informe uma data e hora futuras."), porque quase sempre é erro de digitação e não "daqui a um ano". A checagem de data existente usa o ano inferido (29/02/2027 é recusado).
- `validateNewCampaign` valida o formulário inteiro de uma vez e devolve **ou** os erros por campo **ou** os dados prontos (`{ ok: true, value }`), então a tela não precisa repetir regra nenhuma.

## 7. Autenticação simulada e RBAC

- `lib/auth.ts`: o e-mail precisa ser de uma conta demo e qualquer senha com 6+ caracteres é aceita. **Nenhuma senha é guardada ou comparada** — não existe segredo no código.
- E-mail desconhecido e senha curta recebem a **mesma** mensagem ("E-mail ou senha inválidos."), para não revelar quais contas existem. A redefinição de senha responde sempre de forma neutra ("Se o e-mail estiver cadastrado…") pelo mesmo motivo.
- **RBAC:** `CAMPAIGN_ROLES = ['admin', 'analyst']`, como na tabela de rotas do produto. O Colaborador é barrado no login com mensagem própria.
- **Conclusão de treinamento é de cada pessoa:** o `TrainingsProvider` guarda a conclusão pela chave `usuário:módulo`. Quem entra com outra conta (pelo "Sair" do avatar) não herda o que a anterior concluiu, e a mesma conta reencontra a própria conclusão ao voltar. As campanhas, ao contrário, são da empresa e continuam compartilhadas.

## 8. Testes (jest-expo + Testing Library)

109 testes em 16 suítes (`src/__tests__/`):

- **lib/** — `format` (datas pt-BR, taxa de clique 24/28/31/17% e "—", iniciais, nome a partir do e-mail), `validation` (todas as mensagens, datas inexistentes, passado, próxima ocorrência do mês e virada do ano), `auth` (contas, senha curta, RBAC), `campaigns` (ordem, filtro, KPIs, campanha nova).
- **routes/** — `linking` (caminho de cada tela na web, a tela de base embaixo de quem é aberto pela URL e o e-mail fora da URL).
- **components/** — `TemplateSelect` (rádio: toca seleciona, toca no selecionado mantém, descrição acompanha, estado `checked`; filtro: toca de novo limpa), `GroupPickerModal` (7 grupos, check no selecionado, escolher "RH" atualiza a linha) e `Toast` (posição informada pela tela em foco, e o maior deslocamento vale na troca de telas).
- **screens/** — Login (validações, e-mail fora da lista, colaborador bloqueado, admin/analista entram), Home (filtro muda lista e Total, Total 6 depois de agendar, sair da conta, "Não" mantém a sessão), Nova campanha (erros conferidos pelo papel `alert`, e não só pelo texto, porque "Selecione um modelo." também é a dica inicial; destinatário externo; sucesso com toast abaixo do cabeçalho que some em 2,5 s e Detalhes com "Agendada" e "Não recebeu"; toast abaixo da saudação ao voltar à Home), Detalhes (KPIs por status, campanha inexistente), Treinamento ("Marcar como concluído" ↔ "Concluído", barra 0 → 100%, estado guardado ao voltar, conclusão por pessoa, módulo inexistente), Redefinir senha (a confirmação substitui o formulário na pilha).
- Os testes renderizam o **app inteiro** (providers + navegação) com a área segura do iPhone das capturas e congelam o relógio em 23/09/2026 (`freezeDate`), então "hoje + 7" é sempre 30/09.
- Os testes novos foram conferidos "ao contrário": desfazendo cada correção (voltar a `navigate` na redefinição, conclusão global, toast com cabeçalho fixo, validação de modelo desligada), o teste correspondente falha.

## 9. Diferenças conscientes em relação às capturas

- **Sair da conta:** tocar no avatar abre a confirmação "Deseja sair do Baluarte?" (como no GamePlay do NLW). Sem isso não dava para trocar de perfil na demonstração.
- **Modal de grupo-alvo:** o grupo selecionado ganha um check (a spec pede; a captura mostra só chevrons).
- **Erro de login** aparece num aviso vermelho acima do botão "Entrar" (a captura só mostra o estado inicial).
- **Web:** no navegador o app vira uma coluna de celular (até 480 px) centralizada; no aparelho ocupa a tela toda.
- **Telas estreitas (menos de ~355 px, ex.: 320):** no banner dos Detalhes, "Agendada para…" desce para baixo da pílula em vez de ser cortado (as capturas são de 375 px; em 360 e 375 tudo cabe numa linha).

## 10. Dois modos de dados: demo (padrão) e API real

O app roda contra **mocks em memória** (modo demo, padrão) ou contra a **API do
produto** (modo API), escolhidos só pela variável `EXPO_PUBLIC_API_BASE_URL`.
Por quê e como:

- **Camada de repositório** (`src/data/repository.ts`): a UI (contexts) só conhece
  duas interfaces — `AuthRepository` e `CampaignRepository`. A implementação
  concreta é escolhida uma vez, por ambiente: `mockRepository` (tudo em memória)
  ou `apiRepository` (fetch real). As telas são as mesmas nos dois modos.
- **Demo-safe por padrão:** sem a variável, cai no mock. A demonstração nunca
  depende de rede e os testes rodam no modo demo. O módulo da API (e o
  `expo-secure-store`) só é carregado quando há API configurada (require tardio).
- **Sem segredo no código:** a base URL vem só do `.env` (`EXPO_PUBLIC_…`, fora do
  git). Não é segredo — é o endereço público da API —, mas também não fica
  escrito no repositório. Ver `.env.example`.
- **Token em armazenamento seguro:** no modo API o JWT (HS256, `Authorization:
  Bearer`) vai para o Keychain/Keystore via `expo-secure-store` no celular e para
  o `localStorage` na web (como o frontend web). Nunca para o código.
- **Fidelidade ao backend atual:** o `apiRepository` espelha o `adapters.ts` do
  frontend web — `POST /login` + `GET /me`, `GET /campanhas` (lista) e
  `/campanhas/:id` (detalhe: funil, quem clicou/reportou), templates
  `urgencia/autoridade/curiosidade`, grupo-alvo fixo "Colaboradores internos",
  `scheduledAt` = `criadoEm`. Limites herdados do backend (status sempre
  `AGENDADA`, sem rastreio de abertura/submissão, lista sem destinatários) são
  reproduzidos, não "consertados" no app.
- **Autenticação assíncrona:** `signIn`/`scheduleCampaign` passaram a ser
  assíncronos para suportar a rede; no modo demo resolvem na hora. A Home mostra
  carregando/erro-com-"tentar de novo" e os Detalhes buscam o detalhe rico só no
  modo API (progressivo: primeiro o item da lista, depois o detalhe).
- **Testes da camada nova:** `lib/mappers` (16) cobrem as conversões puras;
  `lib/apiRepository` (8) exercitam login/RBAC/erro de rede/lista/detalhe/criar
  com `fetch` e `expo-secure-store` mockados — nenhuma rede real é tocada.

## 11. Gate de ciência de aviso (modo API)

O backend passou a exigir que a conta registre a ciência do aviso de
monitoramento na versão em vigor; enquanto pendente, as rotas de dados
respondem `403 CIENCIA_AVISO_PENDENTE`. No app (modo API):

- O `GET /me` fica **fora** do gate e traz `cienciaAvisoPendente`, mapeado para
  `User.noticePending`. Como o `/me` responde normalmente, o `restoreSession`
  **não apaga o token** por causa da pendência — a sessão é válida, falta só um
  ato da pessoa. (Token só é limpo em falha real de autenticação.)
- A lista de campanhas (`GET /campanhas`) pode responder 403; o contexto
  reconhece o código `CIENCIA_AVISO_PENDENTE` e, em vez de erro genérico, a Home
  mostra "Confirme o aviso de monitoramento no portal Baluarte para usar o app"
  (sem botão de repetir, que não ajudaria até a ciência ser dada no portal).
- É o conserto **mínimo**: dar a ciência pelo app (tela própria consumindo
  `GET /monitoramento/aviso` + `POST /monitoramento/ciencia`) ficou como opcional,
  já que o portal web resolve a ciência e o app é entrega extra.
- No modo demo nada disso existe (o gate é só do backend real).
