# Baluarte — Frontend

SPA em **React 18 + TypeScript + Vite + TailwindCSS** da plataforma de cibersegurança Baluarte: varredura de vulnerabilidades (OWASP Top 10 2021, CVSS v3.1), phishing simulado com treinamento contextual e dashboard unificado de risco técnico + humano, com **RBAC** (Administrador, Analista, Colaborador).

É o frontend do **produto**. O diretório irmão `../frontend/` é o SPA legado (telas do Figma), mantido apenas como alvo das suítes Robot da N2 AT1.

## Requisitos

- Node.js ≥ 18.18 (testado com 24.x) e npm ≥ 9.
- Para os testes ponta a ponta: Google Chrome instalado (o Playwright usa o canal `chrome` do sistema, sem baixar navegadores).

## Como rodar

```bash
npm install
npm run dev          # http://localhost:5173 — usa a camada mock (sem backend)
```

| Script | O que faz |
|---|---|
| `npm run build` | Typecheck (`tsc --noEmit`) + build de produção em `dist/` |
| `npm run preview` | Serve o build em http://localhost:4173 |
| `npm run typecheck` / `npm run typecheck:e2e` | Typecheck do app / da suíte E2E |
| `npm run lint` / `npm run lint:fix` | ESLint (react, react-hooks, jsx-a11y, @typescript-eslint, prettier) |
| `npm run format` / `npm run format:check` | Prettier |
| `npm test` / `npm run test:watch` / `npm run test:coverage` | Vitest + React Testing Library + axe-core (jsdom) |
| `npm run test:e2e` / `npm run test:e2e:headed` | Playwright (Chrome do sistema) contra o dev server em modo mock |
| `npm run test:all` | typecheck + lint + unit + build + E2E, em sequência |

## Credenciais de demonstração (camada mock)

| E-mail | Senha | Perfil |
|---|---|---|
| `admin@empresa.com` | `Admin@123` | Administrador |
| `analista@empresa.com` | `Senha@123` | Analista |
| `colaborador@empresa.com` | `Colab@123` | Colaborador |

As duas primeiras coincidem com o seed do backend real (`backend/prisma/seed.ts`), então o mesmo login funciona nos dois modos. A tela de login mostra essas credenciais **somente** em modo mock.

## Mock vs. backend real

A única porta de entrada das telas é `src/services/api.ts`, que exporta `api: BaluarteApi`. A implementação é escolhida em tempo de build pela variável `VITE_USE_MOCKS`:

| `VITE_USE_MOCKS` | Modo `dev` | Modo `build` |
|---|---|---|
| vazio (padrão) | mocks | backend real |
| `true` | mocks | mocks (deploy de demonstração — **nunca** use em produção) |
| `false` | backend real | backend real |

- **Mocks** (`src/mocks/`): dados realistas em memória, latência simulada (180–520 ms) e **4 % de falhas aleatórias em leituras** (503) para exercitar os estados de erro/retry das telas. Escritas nunca falham aleatoriamente. Em testes a latência e as falhas são zeradas (`configureMocks`). Para desligar no navegador (demonstrações, E2E), grave no `localStorage` a chave `baluarte.mock` com `{"failureRate":0,"latencyMs":[20,60]}` e recarregue.
- O módulo de mocks entra por `import()` dinâmico guardado por `import.meta.env`, que o Vite substitui estaticamente: um `npm run build` sem a flag **não inclui** dados fictícios nem credenciais no bundle. Verifique com `grep -rl "Admin@123" dist/assets` (deve não retornar nada).
- **Backend real**: axios contra `VITE_API_BASE_URL` (padrão `/api`, que o Vite encaminha para `VITE_API_PROXY_TARGET`, padrão `http://localhost:8080`). O JWT é anexado como `Authorization: Bearer`, qualquer 401 encerra a sessão e um 403 ressincroniza o perfil com `GET /me`. Os adapters em `src/services/adapters.ts` convertem o envelope `{ status, dados, resumo }` e os campos em português do backend Express para os modelos de domínio.

### Rotas do backend usadas

| Área | Rotas |
|---|---|
| Autenticação | `POST /login`, `GET /me`, `POST /auth/change-password`, `POST /auth/reset-password`, `POST /auth/reset-password/confirm` |
| Dashboard e ativos | `GET /dashboard`, `GET /scans`, `POST /scans`, `GET/POST /assets` |
| Vulnerabilidades | `GET /vulnerabilidades[?q=]`, `GET/PATCH /vulnerabilidades/:id` (status inclui `Risco aceito`) |
| Campanhas e treinamento | `GET /campanhas`, `GET /campanhas/:id`, `POST /campaigns` (`destinatario` + `destinatarios[]`), `GET /treinamentos/:token`, `POST /treinamentos/:token/concluir` |
| Usuários | `GET /usuarios`, `POST /users`, `PATCH/DELETE /users/:id` (Administrador) |
| Configurações | `GET /configuracoes/seguranca`, `GET/PUT /configuracoes/notificacoes` |

Todas estão implementadas em `../backend` (testes em `../backend/tests`). `src/services/api.ts` exporta `FEATURES`, um mapa de capacidades hoje todo ligado; as telas continuam consultando-o para esconder uma ação (em vez de mostrar um 404 genérico) caso uma implantação desligue alguma capacidade. Se uma rota não existir no servidor, a camada real converte o 404 `ROTA_NAO_ENCONTRADA` em **501 `NAO_IMPLEMENTADO`**.

### Redefinição de senha

Fluxo em duas etapas na mesma rota: `/reset-password` pede o e-mail (resposta genérica, sem revelar se ele existe) e `/reset-password?token=…` define a nova senha. **Não há serviço de e-mail neste projeto**: no backend real o token aparece no console do servidor (`[reset-senha] token para …`), válido por 30 minutos e de uso único; na camada mock ele volta na própria resposta (`demoToken`) e a tela oferece o link "Continuar para a redefinição".

Para ligar no backend real: suba `../backend` (`npm run db:push && npm run seed && npm run seed:demo && npm run dev`) e rode aqui `VITE_USE_MOCKS=false npm run dev` (ou edite `.env`).

## Variáveis de ambiente

Copie `.env.example` para `.env` (o `.env` é ignorado pelo git; o frontend não guarda segredos — só URLs):

```
VITE_API_BASE_URL=/api
VITE_API_PROXY_TARGET=http://localhost:8080
VITE_USE_MOCKS=
```

## Testes

| Suíte | Onde | O que cobre |
|---|---|---|
| Unitários e de componentes (Vitest + RTL) | `src/__tests__/*.test.ts(x)` | `ProtectedRoute`, RBAC por rota e por navegação, `SeverityBadge`, `DashboardPage`, `LoginPage`, hooks (`useAsync`, `useSort`, `usePagination`), bibliotecas (`format`, `severity`, `roles`, `jwt`, `storage`, `errors`), API mock (autenticação, redefinição de senha, RBAC por endpoint, validações, métricas), adapters e invariantes dos dados fictícios |
| Acessibilidade (axe-core) | `src/__tests__/a11y.test.tsx` | Todas as páginas renderizadas com dados do mock, sem violações (a regra de contraste é auditada manualmente — o jsdom não calcula layout) |
| Ponta a ponta (Playwright, Chrome do sistema) | `e2e/*.spec.ts` | Login/logout/redirecionamento, redefinição de senha (fluxo completo com token), RBAC, vulnerabilidades (filtros, busca global, detalhe, status), campanhas (lista, relatório, criação), usuários (criar/editar/excluir com diálogo), configurações (senha, notificações, tema), treinamento, layout mobile (gaveta com foco preso, sem rolagem horizontal) |
| Ponta a ponta em modo real | `e2e/real-backend.spec.ts` | Com o backend em `:8080` e o frontend em `VITE_USE_MOCKS=false`: login, sessão, "Risco aceito" (ida e volta), campanha com dois destinatários, criar/editar/excluir usuário, troca de senha, preferências de notificação e redefinição de senha. `E2E_REAL=1 E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/real-backend.spec.ts` (`E2E_API_URL` muda a API, padrão `http://localhost:8080/api`) |

## Rotas e RBAC

| Rota | Página | Acesso |
|---|---|---|
| `/login`, `/reset-password[?token=]`, `/about` | Login, redefinição de senha (pedido e confirmação), sobre | público |
| `/dashboard` | Visão geral de risco (2 gauges, KPIs, vulnerabilidades e campanhas recentes, linha do tempo, treinamento pendente) | todos |
| `/vulnerabilities`, `/vulnerabilities/:id` | Lista com filtros/ordenação/paginação; detalhe com abas Visão geral · Evidências · Remediação · Histórico | Admin, Analista |
| `/assets/new` | Cadastro de ativo | Admin, Analista |
| `/campaigns`, `/campaigns/new`, `/campaigns/:id` | Campanhas de phishing: lista, criação, relatório (KPIs, funil, gauge de cliques, destinatários) | Admin, Analista |
| `/training/:id` | Treinamento contextual pós-clique (marcar como concluído) | todos |
| `/users`, `/users/new`, `/users/:id/edit` | Gestão de usuários e perfis | Admin |
| `/settings` | Senha, notificações, tema, política de segurança | todos |

`ProtectedRoute` redireciona anônimos para `/login` (guardando a origem, inclusive query string) e mostra "Acesso negado" para perfis fora da lista. A sessão vive em `localStorage` (`baluarte.token` / `baluarte.user`); **o JWT é a fonte de verdade** para id, e-mail e perfil (o objeto guardado só contribui com o nome), a expiração é verificada com `jwt-decode` e um 401 da API derruba a sessão. O dashboard entrega a colaboradores apenas índices e KPIs — a lista técnica de achados e as métricas por campanha ficam restritas a Admin/Analista também no payload.

## Docker

`Dockerfile` faz o build de produção e o serve com Nginx (`nginx.conf`: fallback de SPA e proxy `/api` → `backend:8080`). Na raiz do repositório, `docker compose up --build backend app` sobe API + este frontend em http://localhost:5173.

## Estrutura

```
src/
  components/      biblioteca de UI (Badge, Gauge, Table, Sidebar, Card, Tabs, EmptyState, LoadingSpinner, Layout, ui/*) + index.ts
  contexts/        AuthContext (JWT, usuário, perfil, login/logout, hasRole) + useAuth (contexto/hook)
  hooks/           useAsync (fetch com loading/erro/retry/keepPreviousData), useSort, usePagination
  lib/             formatação pt-BR, mapas de severidade/status, RBAC, JWT, storage, erros, eventos de sessão
  mocks/           data.ts (dados) e api.ts (implementação mock do contrato)
  pages/           uma pasta por área (Auth, About, Dashboard, Vulnerabilities, Assets, Campaigns, Training, Users, Settings)
  services/        contract.ts (interface BaluarteApi), api.ts (axios + seleção mock/real + FEATURES), adapters.ts
  store/           uiStore (zustand: tema, sidebar, loading global/trackOperation, toasts)
  styles/          tailwind.css
  types/           modelos de domínio
  __tests__/       Vitest (unitários, componentes, RBAC, a11y, mocks, adapters)
e2e/               Playwright (mock e modo real)
Dockerfile · nginx.conf
```

## Direção visual e acessibilidade

- **Telas técnicas** (vulnerabilidades, usuários, campanhas): paleta neutra, tabelas densas, `font-mono` para CVE/hash/versão/IP; cor só nos indicadores de severidade e status (mapas em `src/lib/severity.ts`, contraste ≥ 4,5:1 nos dois temas).
- **Telas gerenciais** (dashboard, relatório de campanha): cards grandes, dois gauges circulares lado a lado, KPIs, linha do tempo de ameaças recentes.
- Layout responsivo (grids viram coluna única em telas pequenas; sidebar recolhível no desktop e gaveta modal no mobile, com foco preso) e tema claro/escuro (`darkMode: 'class'`).
