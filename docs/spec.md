# Especificação — App Baluarte (Programação de App)

App mobile em **React Native + Expo + TypeScript** com as mesmas telas pedidas pelo professor (Login, Home, Detalhes, Agendar com troca de estado da categoria), no **tema e com os dados do Baluarte** — módulo de **phishing simulado** da plataforma de cibersegurança do TCC. O professor aprovou o uso do Baluarte.

Correspondência com o GamePlay: categorias → **modelos de e-mail**; partidas agendadas → **campanhas**; Detalhes do servidor → **Detalhes da campanha**; jogadores → **destinatários**; Disponível/Ocupado → **etapas** (Reportou, Clicou…); Agendar partida → **Nova campanha**; servidor → **grupo-alvo**; descrição → **destinatários**.

> O professor vai perguntar sobre **estrutura de código das telas, componentes e estilização**. Componentes pequenos e reutilizáveis, estilos isolados por componente (`styles.ts`), tema com tokens centralizados e nomes claros são requisitos.

## Fontes de verdade
- Figma: `https://www.figma.com/design/4Y3dexVBOGUzJjjvTWT4ZI` (arquivo "Baluarte — Protótipo App"), 16 telas + componentes.
- Capturas de referência (375×812): `docs/referencias/*.png` — **abra e compare**.
- Ícone, ícone adaptativo, splash e favicon do app (gerados da marca no Figma): `assets/` (icon.png 1024, adaptive-icon.png 1024, splash-icon.png 512, favicon.png 196) — use no `app.json` (splash com fundo `#0B1220`).
- Código web do produto (para copiar textos, regras e cores): repositório do produto ([Leonardolraf/Baluarte](https://github.com/Leonardolraf/Baluarte)), pasta `baluarte-frontend/` — `DESIGN.md`, `tailwind.config.cjs`, `src/lib/severity.ts` (rótulos e classes de status/etapa/modelo), `src/mocks/data.ts` (campanhas e treinamentos), `src/pages/Campaigns/*`, `src/pages/Auth/*`, `src/pages/Training/TrainingPage.tsx`, `src/components/Brand/BaluarteMark.tsx`. **Somente leitura** — não altere nada lá.

## Stack e restrições
- Projeto criado com `npx create-expo-app@latest baluarte --template blank-typescript` (SDK mais recente, hoje 57). Dependências **sempre com `npx expo install`**.
- Navegação: `@react-navigation/native` + `@react-navigation/native-stack` (+ `react-native-screens`, `react-native-safe-area-context`).
- `react-native-svg` + `lucide-react-native` (ícones: AlarmClock, Briefcase, Gift, Plus, Calendar, ArrowLeft, Eye, EyeOff, Users, ChevronRight, X, GraduationCap, CircleCheck/CheckCircle2, Info, Mail, Check), `expo-font` + `@expo-google-fonts/archivo` (500, 700, 800), `@expo-google-fonts/ibm-plex-sans` (400, 500, 600), `@expo-google-fonts/ibm-plex-mono` (400), `expo-splash-screen`, `expo-status-bar`, `expo-linear-gradient`.
- Web: `react-dom`, `react-native-web`, `@expo/metro-runtime`. Tem que rodar no **Expo Go** e no **web**.
- **Sem segredos no código**: nenhuma senha fixa. Autenticação **simulada** (ver Login). **Não usar git.**

## Estrutura de pastas (obrigatória)
```
baluarte/
  App.tsx, app.json (nome "Baluarte", slug "baluarte", userInterfaceStyle dark, backgroundColor #0B1220)
  src/
    theme/ (colors.ts, typography.ts, spacing.ts, index.ts)   # tokens do DESIGN.md
    components/<Nome>/index.tsx + styles.ts
    screens/<Nome>/index.tsx + styles.ts
    routes/ (auth.routes.tsx, app.routes.tsx, index.tsx)
    store/ ou contexts/ (auth, campaigns, trainings, toast)
    data/ (users.ts, campaigns.ts, trainings.ts, groups.ts, templates.ts)
    lib/ (format.ts — datas pt-BR; validation.ts — e-mail/domínio/agendamento)
    types/
```
Componentes esperados: `Screen` (fundo + safe area + StatusBar clara), `Header` (voltar + título), `BaluarteMark` (SVG da marca), `Wordmark`, `Button` (primário branco com texto ink; variante contorno), `FormField` (rótulo, `*` obrigatório em `#DC2626`, dica, erro), `TextField`, `PasswordField` (olho mostra/oculta), `SmallInput`, `TextArea`, `TemplateSelect` + `TemplateCard`, `GroupSelect` + `GroupPickerModal`, `StatusPill`, `StageBadge`, `CampaignListItem`, `ListHeader`, `ListDivider`, `KpiRow`, `Avatar` (iniciais), `Toast`, `ProgressBar`, `SectionCard`.

## Tokens (tema escuro do produto — DESIGN.md: "a única cor cromática da interface é o risco")
| token | valor | uso |
|---|---|---|
| bg.page | `#0B1220` | fundo das telas (slate-950 / ink) |
| bg.surface | `#131C2E` | cabeçalho, cartões, cards de modelo (slate-900) |
| bg.raised | `#1B2A44` | avatares, blocos de ícone (ink-soft) |
| border.default | `#26324A` | bordas e divisórias (slate-800) |
| border.input | `#3C4B63` | borda de input e rádio vazio (slate-700) |
| text.primary | `#EEF2F7` | texto principal |
| text.secondary | `#8E9DB5` | rótulos, legendas |
| text.muted | `#647590` | dicas, placeholders |
| action.primary | `#FFFFFF` | botão primário |
| action.onPrimary | `#0B1220` | texto/ícone sobre o botão primário |
| severity.critical/high/medium/low/info | `#DC2626` / `#EA580C` / `#CA8A04` / `#16A34A` / `#2563EB` | somente risco |

Status de campanha (pílula: fundo, borda, ponto, texto): **Ativa** `rgba(5,46,22,0.6)`, `rgba(34,197,94,0.3)`, `#22C55E`, `#86EFAC` · **Agendada** `rgba(8,47,73,0.6)`, `rgba(14,165,233,0.3)`, `#0EA5E9`, `#7DD3FC` · **Encerrada** `#26324A`, `rgba(100,117,144,0.3)`, `#647590`, `#C3CEDC`.
Etapas do destinatário (ponto, texto): **Recebeu** `#647590`, `#DCE3EC` · **Abriu** `#0EA5E9`, `#7DD3FC` · **Clicou** `#EA580C`, `#FDBA74` · **Submeteu credenciais** `#DC2626`, `#FCA5A5` · **Reportou** `#16A34A`, `#86EFAC` · **Não recebeu** `#647590`, `#8E9DB5`.
Tipografia: display = Archivo 700/800 (títulos, numerais, wordmark); corpo = IBM Plex Sans 400/500/600; dados = IBM Plex Mono 400 (e-mails). Rótulos em caixa alta: 10–11, 600, letterSpacing ~0.8, cor secondary.
Espaçamento base 4 (DESIGN.md): inset de tela 24, cartão 16–20, entre campos 16–20, botões 48 de altura, raio 8 (inputs/botões) e 12 (cartões).

`BaluarteMark` (react-native-svg, viewBox 32): `<Rect width=32 height=32 rx=8 fill=#FFFFFF/>`, `<Path d="M16 5.5 26.5 12.6 22.6 25.5H9.4L5.5 12.6Z" stroke=#0B1220 strokeWidth=2.2 strokeLinejoin=round fill=none/>`, `<Path d="M12.2 17.2 15 20l4.9-5.2" stroke=#0B1220 strokeWidth=2.2 strokeLinecap=round strokeLinejoin=round fill=none/>`. Ilustração de fundo do Login: três pentágonos concêntricos (mesma forma, escalas ~10.5/8/5.6 centradas atrás da marca) com traço `#26324A`, opacidades 0.9/0.7/0.5.

## Dados (reproduzir de `src/mocks/data.ts` do produto; datas relativas a "hoje", 09:00)
Usuários demo (sem senha no código): `admin@empresa.com` → Leonardo Rodrigues, Administrador, Diretoria · `analista@empresa.com` → Rafael Nunes, Analista, TI · `colaborador@empresa.com` → João Pereira, Colaborador, Comercial.

Modelos (templates): **Urgência** — "Pressão por ação imediata: \"sua conta será bloqueada em 24h\"." · **Autoridade** — "Solicitação vinda de um \"diretor\" ou de \"TI\": \"atualize sua senha agora\"." · **Curiosidade** — "Isca de interesse: \"veja o novo plano de cargos e salários\"." Ícones: AlarmClock, Briefcase, Gift.

Grupos-alvo (TARGET_GROUPS): Financeiro, TI, RH, Comercial, Operações, Diretoria, Todos os colaboradores.

Campanhas (métricas: destinatários, enviados, abertos, clicaram, submeteram, reportaram):
| nome | modelo | grupo | status | agendada | métricas | amostra de destinatários (etapa) |
|---|---|---|---|---|---|---|
| Diretoria – Autoridade Q4 | Autoridade | Diretoria | Agendada | hoje +25 d | 24, 0, 0, 0, 0, 0 | Marcelo Martins, Patrícia Pereira, Otávio Oliveira (Não recebeu) |
| Simulação Q3 – Financeiro | Urgência | Financeiro | Ativa | hoje −5 d | 156, 156, 97, 37, 17, 30 | Ana Almeida (Reportou), Bruno Barbosa (Clicou), Carla Cardoso (Submeteu credenciais) |
| Fake Invoice Julho | Curiosidade | Comercial | Encerrada | hoje −62 d | 120, 120, 70, 34, 16, 11 | Gabriela Gonçalves (Submeteu credenciais), Henrique Lima (Recebeu), Isabela Martins (Clicou) |
| Campanha Junho 2026 – Urgência | Urgência | Toda a empresa | Encerrada | hoje −92 d | 203, 203, 144, 63, 30, 24 | Daniel Dias (Abriu), Eduarda Esteves (Reportou), Felipe Ferreira (Clicou) |
| Simulação Credencial Maio | Autoridade | TI e Operações | Encerrada | hoje −118 d | 180, 180, 119, 31, 14, 40 | João Nunes (Reportou), Larissa Oliveira (Reportou), Natália Queiroz (Abriu) |

Taxa de clique = clicaram / enviados (arredondar: 24%, 28%, 31%, 17%); "—" quando enviados = 0.

Treinamentos (texto exato de `src/mocks/data.ts`, ids `trn-urgency`, `trn-authority`, `trn-curiosity`): código US-005/US-006/US-007, título, tipo de ataque ("Phishing por urgência"…), resumo, 3 seções (título + corpo), "Sinais de alerta" (4 itens) e "Boas práticas" (4 itens). Copie os textos do arquivo do produto, sem resumir.

## Telas e comportamento
Todas as telas: fundo `bg.page`, StatusBar clara, conteúdo respeitando safe area; largura fluida (padding 24), sem posições absolutas frágeis. Capturas de referência mostram o layout esperado.

1. **Login** (`01-login.png`): ilustração (pentágonos + `BaluarteMark` 64), wordmark **"Baluarte"** (Archivo 800 26), tagline **"PLATAFORMA DE CIBERSEGURANÇA"** (IBM Plex 600 10, letterSpacing largo), título **"Entrar no Baluarte"** (Archivo 700 28), subtítulo **"Acesse o painel unificado de risco técnico e humano da sua empresa."**; campos **E-mail*** (placeholder `voce@empresa.com`, pré-preenchido `admin@empresa.com`) e **Senha*** (placeholder `••••••••`, vazio, olho mostra/oculta); botão **"Entrar"**; link **"Esqueci minha senha"**; rodapé **"Perfis: Administrador · Analista · Colaborador"**.
   - Validação (mensagens do produto): "E-mail é obrigatório", "Formato de e-mail inválido", "Senha é obrigatória" (mínimo 6 caracteres: "A senha deve ter ao menos 6 caracteres.").
   - Autenticação **simulada**: e-mail tem que ser um dos 3 demo, senão "E-mail ou senha inválidos."; qualquer senha com 6+ caracteres é aceita (modo demonstração — **não** guarde senhas). **RBAC**: Colaborador não acessa campanhas → mensagem "O perfil Colaborador não tem acesso às campanhas neste app." (como no produto, campanhas são de Administrador e Analista).
2. **Redefinir senha** (`02-redefinir-senha.png`): voltar, marca 48, **"Redefinir senha"**, **"Informe o e-mail cadastrado. Se ele existir, enviaremos um link para criar uma nova senha."**, campo E-mail*, botão **"Enviar link de redefinição"**, link **"Voltar ao login"**. Validação de e-mail igual ao Login. Enviar → tela 3.
3. **Solicitação enviada** (`03-solicitacao-enviada.png`): ícone Mail num círculo verde, **"Solicitação enviada"**, **"Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes."**, dica **"Não recebeu? Verifique a caixa de spam ou aguarde alguns minutos antes de tentar de novo."**, botão **"Voltar ao login"** (volta ao Login limpando a pilha).
4. **Home** (`04-home.png`, `07-home-apos-agendar.png`): avatar com iniciais, **"Olá, {primeiro nome}"** (Archivo 500/700 22), **"{Perfil} · {Departamento}"**; botão **"+"** 48×48 branco → Nova campanha. `TemplateSelect` modo exibição (3 cards 104×120 com ícone 32 e rótulo) que **filtra a lista** por modelo (tocar seleciona com borda branca; tocar de novo limpa). **"Campanhas"** + **"Total N"**. Lista (FlatList, ordenada pela data agendada, mais recente primeiro): bloco 64×64 com o ícone do modelo, nome (1 linha, reticências), modelo à direita, ícone calendário + **"DD/MM às HH:MMh"**, status (ponto + texto na cor do status), divisória. Tocar → Detalhes daquela campanha.
5. **Nova campanha** (`05-nova-campanha.png`): cabeçalho **"Nova campanha"** com voltar. Campos na ordem: **Nome da campanha*** (placeholder "Ex.: Simulação Q4 – Financeiro"; 3–80 caracteres: "O nome deve ter ao menos 3 caracteres." / "O nome deve ter no máximo 80 caracteres."); **Modelo de e-mail*** = `TemplateSelect` modo **rádio** (cards com rádio no canto; selecionado: borda branca 2 px + fundo `#1F2738`, ícone/rótulo brancos, rádio branco preenchido com ponto ink; não selecionado: borda `#26324A`, ícone/rótulo `#8E9DB5`, rádio vazado `#3C4B63`); abaixo, a descrição do modelo selecionado (ou "Selecione um modelo."). **Tocar no modelo já selecionado mantém a seleção** (é rádio, como no produto). **Grupo-alvo*** = linha (bloco com ícone Users, nome do grupo, legenda "Toque para trocar o grupo-alvo", chevron) que abre `GroupPickerModal` (título "Grupo-alvo", fechar X, os 7 grupos, check no selecionado; tocar escolhe e fecha). **Dia e mês** / **Horário** (4 `SmallInput`, pré-preenchidos com hoje +7 dias às 09:00) + dica **"A campanha dispara automaticamente na data e hora informadas."**; validação: data/hora válidas e no futuro ("Informe uma data e hora futuras."). **Destinatários*** (TextArea em IBM Plex Mono, um e-mail por linha ou separados por vírgula/ponto e vírgula; dica à direita "Somente @empresa.com"; pré-preenchido com ana.almeida@, bruno.barbosa@, carla.cardoso@ empresa.com); validação: "Informe ao menos um destinatário.", "E-mail inválido: {x}", "Somente destinatários @empresa.com: {x}". Botão **"Agendar campanha"** (ícone Calendar).
   - Ao agendar com sucesso: cria a campanha (status Agendada, métricas zeradas, destinatários = lista informada com nome derivado do e-mail, ex. "ana.almeida" → "Ana Almeida", etapa "Não recebeu"), mostra o **Toast "Campanha agendada com sucesso"** (some sozinho em ~2,5 s) e vai para os **Detalhes da campanha nova**, substituindo a Nova campanha na pilha (voltar leva à Home, que agora mostra a campanha nova e Total 6).
6. **Detalhes da campanha** (`06`, `09`, `10`, `12`): cabeçalho **"Detalhes"** + voltar. Banner (gradiente `#131C2E → #0B1220`, pentágonos decorativos à direita): `StatusPill` + calendário + **"Agendada para DD/MM/AAAA HH:MM"**; nome (Archivo 700 22, até 2 linhas); **"Grupo-alvo: X · Modelo: Y"**; KPIs (Archivo 800 22 + rótulo caps): Agendada → `N DESTINATÁRIOS`, `0 ENVIADOS`, `— TAXA DE CLIQUE`; demais → `ENVIADOS`, `TAXA DE CLIQUE`, `REPORTARAM`. **"Destinatários"** + **"Total N"** e a amostra (avatar com iniciais, nome, ponto + etapa colorida). Se Agendada: aviso com ícone Info **"Campanha ainda não disparada — as etapas aparecem depois do envio."** Botão **"Ver material de treinamento"** (bloco com GraduationCap à esquerda) → Treinamento do modelo da campanha.
7. **Treinamento** (`11-treinamento-urgencia.png`): cabeçalho **"Treinamento"** + voltar; ScrollView: pílula com o tipo de ataque + código (US-00X); título (Archivo 700 24); resumo; **"PROGRESSO"** + barra (0% → 100% ao concluir); 3 cartões de seção; cartão **"Sinais de alerta"** (subtítulo "O que denuncia uma mensagem maliciosa") com os 4 itens; cartão **"Boas práticas"** ("Como reagir com segurança") com 4 itens; cartão **"Conclusão"** com o botão **"Marcar como concluído"** ↔ **"Concluído"** (verde, ícone check) que alterna e mostra o Toast **"Treinamento concluído!"** ao concluir. O estado de conclusão fica guardado por módulo (voltar e entrar de novo mantém).

## Testes (jest-expo + @testing-library/react-native)
- Login: validações; e-mail fora da lista → erro; colaborador → mensagem de RBAC; admin + senha válida → Home.
- TemplateSelect rádio: tocar seleciona, tocar no selecionado mantém; descrição acompanha (`accessibilityRole="radio"` + `accessibilityState.checked`).
- Nova campanha: destinatário externo → erro "Somente destinatários @empresa.com: …"; sucesso → campanha criada, toast exibido, navegação para Detalhes com status Agendada e "Não recebeu".
- GroupPickerModal: escolher "RH" atualiza a linha.
- Home: filtro por modelo altera a lista e o Total; Total 6 depois de agendar.
- Treinamento: botão alterna "Marcar como concluído" ↔ "Concluído" e a barra vai a 100%.
- `lib/validation.ts` e `lib/format.ts` com testes unitários.

## Validação obrigatória antes de encerrar
1. `npx tsc --noEmit` sem erros. 2. `npx jest --ci` passando. 3. `npx expo export --platform web` sem erro. 4. `npx expo-doctor` sem problemas críticos. 5. `README.md` (como rodar no Expo Go, web, testes, contas demo sem senha fixa, estrutura) e `ESCOLHAS.md` (em português, para a apresentação: estrutura, componentes, estado da seleção de modelo, tokens/estilização, navegação, validações, RBAC, testes).
