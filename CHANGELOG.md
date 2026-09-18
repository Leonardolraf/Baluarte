# Changelog — Baluarte

> Histórico do que foi construído no repositório de código, do commit inicial até hoje. Para o que falta e o roteiro futuro, ver [`backend/PLANO.md`](backend/PLANO.md). Para como rodar cada peça, ver [`README.md`](README.md).

## 2026-03-26 — Ponto de partida

- **[`732a69f`](https://github.com/Leonardolraf/Baluarte/commit/732a69f)** `Initial commit` — repositório criado, só com um `README.md` mínimo.

## 2026-06-18 — Suítes de teste da N2 AT1 (Teste de Software)

Três commits no mesmo dia, construindo as suítes de teste exigidas pela disciplina **antes** de existir um app real — os testes rodam contra páginas HTML estáticas ("stubs") e um stub-server, servindo de especificação executável do contrato:

- **[`98aa06b`](https://github.com/Leonardolraf/Baluarte/commit/98aa06b)** `Adiciona testes de software (N2 AT1): API (Postman) e UI (Robot+Selenium)` — primeira collection Postman/Newman (`testes/api/`) e os primeiros testes Robot Framework + Selenium (`cadastro_usuario`, `campanha_phishing`), cada um com seu stub HTML e evidências (`log.html`, `report.html`, screenshots).
- **[`e26a1c8`](https://github.com/Leonardolraf/Baluarte/commit/e26a1c8)** `Adiciona testes de Edson e André (N2 AT1): API (assets/users/campaigns/cvss) e UI (login/alterar-senha/cadastro-ativo/reset-senha)` — expande a collection (ativos, usuários, campanhas, classificação CVSS) e mais 4 suítes Robot (`login`, `alterar_senha`, `cadastro_ativo`, `reset_senha`). 35 requisições / 70 asserções na API, 29 testes de UI ao final.

## 2026-06-18 — Nasce o app real (BaluarteV2)

- **[`e414d94`](https://github.com/Leonardolraf/Baluarte/commit/e414d94)** `Adiciona o app real BaluarteV2 (backend Express+Prisma + frontend React/Vite)` — commit fundacional do produto: backend Node+Express+TypeScript+Prisma+SQLite com as 6 rotas do contrato N2 AT1 (`/login`, `/scans`, `/assets`, `/users`, `/campaigns`, `/findings/classificacao`), auth JWT + bcrypt; e o **frontend legado** (`frontend/`, gerado a partir do protótipo Figma) com todas as telas (dashboard, vulnerabilidades, campanhas, usuários, configurações, formulários). `docker-compose.yml` inicial. Os testes Robot passam a mirar esse app real (`e2e/`) em vez dos stubs.

## 2026-09-11 — Segundo frontend, contas e RBAC no servidor

- **[`0ee6e22`](https://github.com/Leonardolraf/Baluarte/commit/0ee6e22)** `Adiciona frontend React do produto e rotas de conta/usuários/treinamento no backend` — nasce **`baluarte-frontend/`**, o frontend do produto propriamente dito (SPA React 18 + TypeScript + Vite + Tailwind, ~60 arquivos: rotas, contexto de auth, camada de mocks para dev sem backend, adapters para o envelope `{status, dados, resumo}` da API, Vitest + RTL + axe, Playwright). No backend, `routes/manage.ts` novo: troca de senha, redefinição por token, preferências de notificação, conclusão de treinamento, CRUD de usuários fora do contrato, exclusão de campanha — mais `AuditLog` registrando toda escrita. `CLAUDE.md` do repositório criado.
- **[`6e3af59`](https://github.com/Leonardolraf/Baluarte/commit/6e3af59)** `Docker: corrige a imagem da API e torna a stack persistente e testada` — `backend/docker-entrypoint.sh` (gera `JWT_SECRET` no volume quando ausente, aplica schema, roda seed), Dockerfile corrigido, volume nomeado para o SQLite sobreviver a reinícios.
- **[`22bb814`](https://github.com/Leonardolraf/Baluarte/commit/22bb814)** `Aplica RBAC no servidor, fecha achados de segurança e fecha a stack Docker` — `exigeToken` passa a reler o usuário do banco a cada requisição (detecta conta removida/inativa/senha redefinida), `exigePerfil` decide pelo perfil do banco, não pelo token; CORS restrito, `x-powered-by` desligado, limite de corpo JSON; três serviços do Compose (backend `:8080`, frontend novo `:8081` via Nginx, legado `:3000`) validados de ponta a ponta.

## 2026-09-13 — Redesign, pentest e plano do backend

- **[`60938fe`](https://github.com/Leonardolraf/Baluarte/commit/60938fe)** `Redesenha o frontend com identidade visual própria (a cor é o risco)` — identidade visual própria documentada em [`baluarte-frontend/DESIGN.md`](baluarte-frontend/DESIGN.md): paleta monocromática `ink` com a severidade como única cor cromática, tipografia Archivo (display/numerais) + IBM Plex Sans/Mono, ritmo de espaçamento em base 4px, marca própria (bastião pentagonal, `BaluarteMark`) substituindo o escudo genérico, build de produção sem source maps e sem `console.*`/`debugger` (código-fonte não fica exposto no DevTools do navegador).
- **[`069d365`](https://github.com/Leonardolraf/Baluarte/commit/069d365)** `Adiciona suíte de pentest (106 testes) e corrige os achados no backend` — 106 testes de segurança em `backend/tests/seguranca/` (injeção, autorização, força bruta, validação de dados, exposição de infraestrutura), banco isolado por arquivo de teste. Achados reais corrigidos no backend: rate limit de login (5 tentativas/15min), bloqueio de conta `Inativo`, resposta com tempo constante em e-mail inexistente, coerção seguros de `query params`, corpo grande rejeitado sem stack trace.
- **[`8a1f376`](https://github.com/Leonardolraf/Baluarte/commit/8a1f376)** `Adiciona o plano de evolução do backend (do estado atual ao alvo do DRS)` — [`backend/PLANO.md`](backend/PLANO.md): inventário honesto do que existe, gap por requisito do DRS, arquitetura-alvo em módulos de domínio e 7 fases (extrair serviços → Postgres → RS256+e-mail → scanner real → campanhas reais → relatórios → hardening de produção).

## 2026-09-14 — Demo pública na Vercel

- **Validação manual da stack Docker** — Docker Desktop parado desde a sessão anterior; reiniciado, `docker compose up -d` e os 3 serviços confirmados saudáveis (`backend` healthy, `app` e `frontend` respondendo 200).
- **Diagnóstico de login do perfil Colaborador** — o usuário `colaborador@empresa.com` / `Colab@123` documentado no `README.md` existe **só na camada de mocks do frontend**, não no backend real; a conta real seedada por `seed:demo` é `ana.souza@empresa.com` / `Mudar@123`. Confirmado por login direto na API (`/api/login`).
- **Deploy do frontend na Vercel** — `baluarte-frontend/` publicado como demo pública em **https://baluarte-security.vercel.app**, com `VITE_USE_MOCKS=true` (build de produção fala com a camada mock em memória, não com o backend real). Motivo: o backend (Express + SQLite, processo de longa duração com arquivo em disco) não roda no modelo serverless da Vercel sem uma reescrita para funções + banco externo — isso é exatamente a Fase 1 (Postgres) do `PLANO.md`, ainda não feita.
- **Correção da configuração do projeto na Vercel** — o link automático ao repositório GitHub tinha ficado com `Root Directory` na raiz do monorepo (em vez de `baluarte-frontend/`) e sem `VITE_USE_MOCKS` persistido; um push já tinha disparado um deploy automático que falhou por causa disso. Corrigido via API (`rootDirectory: "baluarte-frontend"`, variável de ambiente persistida em production+preview) e validado com um redeploy limpo.
- **[`a24e6de`](https://github.com/Leonardolraf/Baluarte/commit/a24e6de)** `Adiciona changelog do projeto e ignora config local da Vercel` — este arquivo, consolidando o histórico acima; `.gitignore` do frontend passa a ignorar `.vercel/`.
- **[`5716a55`](https://github.com/Leonardolraf/Baluarte/commit/5716a55)** `Corrige rotas quebradas na Vercel com fallback de SPA` — acesso direto por URL a qualquer sub-rota (ex.: `/users`) caía num **404 da própria Vercel**, não da aplicação: faltava [`baluarte-frontend/vercel.json`](baluarte-frontend/vercel.json) com o rewrite que o Nginx já fazia no Docker (`try_files … /index.html`). Sem ele, link direto, F5 e favorito quebravam.

## 2026-09-18 — Indicadores navegáveis, contraste da barra lateral e lint

- **[`21ff855`](https://github.com/Leonardolraf/Baluarte/commit/21ff855)** `Abre listagem de ativos e de colaboradores treinados pelo dashboard` — os indicadores "Ativos monitorados" e "Colaboradores treinados" não tinham destino. Duas telas novas, ambas restritas a Administrador e Analista (a segunda expõe dado individual — RN-006), na navegação e na auditoria axe:
  - **`/assets`** ([`AssetListPage`](baluarte-frontend/src/pages/Assets/AssetListPage.tsx)) — inventário com tipo, IP, status, achados abertos (o número leva às vulnerabilidades do host) e última varredura.
  - **`/trainings`** ([`TrainedCollaboratorsPage`](baluarte-frontend/src/pages/Training/TrainedCollaboratorsPage.tsx)) — conclusões do treinamento contextual, com tabela por colaborador e distribuição por departamento.
  - Os números saem da **mesma fonte dos indicadores do dashboard**, para as telas não se contradizerem: `/assets` destaca os ativos em operação (não o total cadastrado) e `/trainings` usa `metrics.trained` das campanhas, declarando quantas conclusões têm registro individual — a tabela de destinatários cobre só parte da população.
  - A tela de treinamentos faz 1+N requisições (campanhas + um relatório por campanha), o que multiplicaria a chance de falha; usa `Promise.allSettled` e consolida o que carregou, avisando quantas campanhas ficaram de fora.
  - **Barra lateral no tema escuro:** `ink` e `slate-950` são a mesma cor (`#0B1220`), então navegação e conteúdo ficavam indistinguíveis. A barra passou a usar `slate-900` com borda — a mesma superfície da barra superior. O tema claro não muda.
- **[`a488663`](https://github.com/Leonardolraf/Baluarte/commit/a488663)** + **[`c068783`](https://github.com/Leonardolraf/Baluarte/commit/c068783)** + **[`137fcca`](https://github.com/Leonardolraf/Baluarte/commit/137fcca)** — **`npm run lint` era impossível de passar no Windows**: o repositório guarda LF, mas `core.autocrlf=true` entregava CRLF no checkout e o Prettier (`endOfLine: "lf"`) acusava cada linha de cada arquivo — 16.800 avisos com `--max-warnings=0`. Regra global `* text=auto eol=lf` no [`.gitattributes`](.gitattributes) resolve na origem, sem configuração por máquina e sem mudar nenhum conteúdo versionado (`git diff --ignore-cr-at-eol` ficou vazio nos 134 arquivos alinhados). A evidência gerada pelo Robot ficou como `-text`, fora de qualquer conversão. Resultado: 16.800 avisos → **0**.

## Resumo por área (estado atual)

| Área | O que existe | Desde |
|---|---|---|
| Contrato N2 AT1 (6 rotas + `frontend/` legado) | Completo, intocado desde `e414d94` | 2026-06-18 |
| Backend real (Express+Prisma+SQLite, RBAC server-side, AuditLog) | Completo para o escopo atual (scanner e phishing simulados) | 2026-09-11 |
| Frontend do produto (`baluarte-frontend/`) | Completo, com identidade visual própria, RBAC por tela e todos os indicadores do dashboard navegáveis | 2026-09-18 |
| Testes | 144 no backend (38 integração + 106 pentest) · 323 no frontend (Vitest+RTL+axe) + Playwright · Newman 70 + Robot 29 (N2 AT1) | 2026-09-18 |
| Deploy | Docker Compose local (3 serviços) + demo pública na Vercel (frontend/mock), com deploy automático a cada push na `main` | 2026-09-18 |
| Lint / formatação | `npm run lint` limpo em qualquer sistema (LF forçado no `.gitattributes`) | 2026-09-18 |
| Plano de evolução (Postgres, RS256, e-mail, scanner real, campanhas reais, hardening) | Documentado, não iniciado | `backend/PLANO.md` |
