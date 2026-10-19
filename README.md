# Baluarte — app mobile (Programação de App)

App em **React Native + Expo (SDK 57) + TypeScript** com o módulo de **phishing simulado** do Baluarte, a plataforma de cibersegurança do TCC. As telas pedidas pelo professor (Login, Home, Detalhes e Agendar com troca de estado da categoria) foram adaptadas para o domínio do produto:

| GamePlay (NLW) | Baluarte |
|---|---|
| Categorias | Modelos de e-mail (Urgência, Autoridade, Curiosidade) |
| Partidas agendadas | Campanhas |
| Detalhes do servidor | Detalhes da campanha |
| Jogadores (Disponível/Ocupado) | Destinatários (Reportou, Clicou, Não recebeu…) |
| Agendar partida | Nova campanha |
| Servidor | Grupo-alvo |

> Entrega da disciplina de Programação de App (UCB). Protótipo no Figma:
> [Baluarte — Protótipo App](https://www.figma.com/design/4Y3dexVBOGUzJjjvTWT4ZI).
> A versão original pedida pelo professor (GamePlay, NLW Together) está em
> [Leonardolraf/GamePlay-App](https://github.com/Leonardolraf/GamePlay-App).
> Os dois apps são independentes: cada repositório instala e roda sozinho.

## Como rodar

Pré-requisitos: Node 22.13+ (linha 22) ou 24.3+ (testado com Node 24.16 e npm 11; o React Native 0.86 e a Testing Library 14 não aceitam Node 20) e, para o celular, o app **Expo Go** (SDK 57).

```bash
git clone https://github.com/Leonardolraf/Baluarte-Mobile.git
cd Baluarte-Mobile
npm install
npm start               # Metro na porta 8083; escaneie o QR code com o Expo Go (Android) ou a câmera (iOS)
npm run android         # Expo Go num emulador/aparelho Android
npm run ios             # Expo Go no simulador iOS (macOS)
npm run web             # versão web no navegador
```

Os scripts fixam o Metro na porta **8083**, então o app roda junto com o GamePlay (porta 8082) e com o Docker do Baluarte (8081) sem conflito — prefira `npm start` a `npx expo start`, que usaria a 8081.

Tudo o que o app usa já vem no Expo Go (nenhum módulo nativo extra), então não é preciso gerar build de desenvolvimento.

No navegador, cada tela tem URL própria (`/campanhas`, `/campanhas/nova`, `/campanhas/camp-001`, `/treinamentos/trn-urgency`…) e o botão Voltar do navegador navega dentro do app. A sessão e as campanhas criadas ficam só em memória: recarregar a página volta ao Login e, depois de entrar, o app reabre a tela da URL (com a Home embaixo). Para servir o `dist/` gerado pelo `export:web` num servidor estático, ative o fallback de SPA (todas as rotas entregam o `index.html`), por exemplo `npx serve -s dist`.

## Contas de demonstração

A autenticação é **simulada** e o código **não tem nenhuma senha fixa**: vale qualquer senha com **6 ou mais caracteres**, desde que o e-mail seja de uma das contas abaixo.

| E-mail | Pessoa | Perfil | Acesso |
|---|---|---|---|
| `admin@empresa.com` (já vem preenchido) | Leonardo Rodrigues | Administrador · Diretoria | entra |
| `analista@empresa.com` | Rafael Nunes | Analista · TI | entra |
| `colaborador@empresa.com` | João Pereira | Colaborador · Comercial | bloqueado pelo RBAC |

Como no produto web, campanhas são só de Administrador e Analista; o Colaborador recebe "O perfil Colaborador não tem acesso às campanhas neste app.". Para trocar de conta, toque no avatar da Home e confirme a saída.

Os dados são os do produto (arquivo `baluarte-frontend/src/mocks/data.ts` do repositório [Leonardolraf/Baluarte](https://github.com/Leonardolraf/Baluarte)), guardados em memória: as datas das campanhas são relativas a **hoje às 09:00**, então a lista sempre parece atual. Nada é enviado de verdade (nem e-mail de campanha, nem link de redefinição de senha).

## Modo API (backend real) — opcional

Por padrão o app roda em **modo demo** (tudo em memória, login simulado). Para
rodar contra a **API real do produto** ([Leonardolraf/Baluarte](https://github.com/Leonardolraf/Baluarte)),
defina a base da API em `EXPO_PUBLIC_API_BASE_URL` (veja `.env.example`):

```bash
cp .env.example .env
# edite .env:  EXPO_PUBLIC_API_BASE_URL=http://localhost:8080/api
npm start
```

Nesse modo o app faz `POST /api/login`, guarda o token JWT em **armazenamento
seguro** (Keychain/Keystore no celular via `expo-secure-store`; `localStorage` na
web) e lê as campanhas de `GET /api/campanhas`. A base URL **não é segredo** e
nunca fica no código — só no `.env` (fora do git). A troca é transparente: as
mesmas telas rodam nos dois modos, escolhidos só por essa variável, e caem no
modo demo quando ela está ausente. O que o app consome da API segue o backend
atual (campanhas sempre `AGENDADA`, sem rastreio de abertura/submissão, lista
sem destinatários — o detalhe traz quem clicou/reportou).

> Contas: o modo demo aceita as contas `@empresa.com` abaixo; o modo API exige
> uma conta real cadastrada no backend (domínio interno, ex.: `@baluarte.test`).

## Scripts

| Comando | O que faz |
|---|---|
| `npm test` | Jest (jest-expo + Testing Library) — 16 suítes, 109 testes |
| `npm run typecheck` | `tsc --noEmit` com TypeScript estrito |
| `npm run export:web` | `expo export --platform web` (gera `dist/`) |
| `npx expo-doctor` | confere dependências e configuração do SDK |

## Estrutura

```
Baluarte-Mobile/
  App.tsx                  fontes + splash + SafeAreaProvider + providers + rotas
  app.json                 nome "Baluarte", tema escuro, fundo #0B1220, ícones e splash da marca
  src/
    theme/                 tokens: colors, typography, spacing, icons (Lucide), fonts
    components/<Nome>/     index.tsx (componente) + styles.ts (StyleSheet)
    screens/<Nome>/        index.tsx (tela) + styles.ts
    routes/                auth.routes.tsx, app.routes.tsx, index.tsx (troca pela sessão), options.ts, linking.ts (URLs na web)
    contexts/              auth, campaigns, trainings, toast (+ AppProviders)
    data/                  users, campaigns, trainings, groups, templates
    lib/                   format (datas pt-BR), validation, auth (RBAC), campaigns (regras), labels
    types/                 modelos de domínio e tipos da navegação
    test-utils/            renderApp(), relógio congelado para os testes
    __tests__/             lib/, routes/, components/, screens/
```

Telas: `Login`, `ResetPassword`, `ResetSent`, `Home`, `NewCampaign`, `CampaignDetails`, `Training`.

Componentes: `Screen`, `Header`, `BackButton`, `BaluarteMark`, `BastionRings`, `Wordmark`, `Button`, `ButtonIcon`, `SquareButton`, `FormField`, `TextField`, `PasswordField`, `SmallInput`, `TextArea`, `ErrorBanner`, `TemplateSelect`, `TemplateCard`, `GroupSelect`, `GroupPickerModal`, `StatusPill`, `StageBadge`, `Tag`, `CampaignListItem`, `RecipientListItem`, `ListHeader`, `ListDivider`, `KpiRow`, `CampaignBanner`, `Avatar`, `InfoNote`, `BulletList`, `SectionCard`, `ProgressBar`, `Toast`, `ToastOffset`, `ConfirmDialog`.

As decisões de código (para a apresentação) estão em [`ESCOLHAS.md`](./ESCOLHAS.md).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`ESCOLHAS.md`](./ESCOLHAS.md) | decisões de estrutura, componentes, estado e estilização (para a apresentação) |
| [`docs/spec.md`](./docs/spec.md) | especificação usada para construir o app (telas, tokens, dados, comportamento, testes) |
| [`docs/referencias/`](./docs/referencias/) | capturas das telas do Figma (375×812) usadas na comparação visual |
| [`docs/VALIDACAO.md`](./docs/VALIDACAO.md) | resultado da validação (tipos, testes, build web, expo-doctor, fluxo no navegador e teste de independência) |
