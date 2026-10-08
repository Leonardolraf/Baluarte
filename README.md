# Baluarte V2

Plataforma web de **segurança ofensiva e conscientização** (TCC de Engenharia de Software — UCB), construída como sistema **real** para a disciplina de **Teste de Software**: backend + frontend de verdade, contra os quais rodam as suítes de teste de API (Postman/Newman) e de UI (Robot Framework + Selenium) da N2 AT1 — não mais contra stubs.

> ⚠️ **Escopo honesto:** a *plataforma* é real (autenticação JWT, RBAC, persistência, dashboard com agregações reais, trilha de auditoria). O **scanner OWASP** e o **disparo de phishing** são **simulados no servidor** (criar varredura gera achados realistas) — nenhum ataque real é executado. A campanha de phishing envia de verdade um **e-mail simulado** a cada destinatário interno cadastrado, identificado no rodapé como simulação da plataforma, sem anexo, sem pedido de senha e só com links para o próprio frontend (treinamento e "reportar"). Esse e-mail e os de conta (convite e redefinição de senha) vão para o Mailpit do Docker Compose (`http://localhost:8025`), que não entrega nada para fora.

## Arquitetura

| Camada | Pasta | Stack | Porta |
|---|---|---|---|
| **API** | `backend/` | Node + Express + TypeScript + Prisma · JWT (HS256) + bcrypt · RBAC · AuditLog | `8080` |
| **Banco** | `docker-compose.yml` (`db`) | PostgreSQL 16 · migrations Prisma · restrições CHECK · `citext` | `5432` (só local) |
| **Frontend (produto)** | `baluarte-frontend/` | React 18 + Vite + TypeScript + TailwindCSS · RBAC por rota · tema claro/escuro · camada mock ou backend real | `5173` (dev) · `8081` (Docker) |
| **Frontend legado** | `frontend/` | React 18 + Vite (telas geradas do Figma) — mantido **só** como alvo das suítes Robot da N2 AT1 | `3000` |

Os dois frontends fazem proxy de `/api` → `http://localhost:8080`. Novas telas e funcionalidades vão em `baluarte-frontend/`; `frontend/` não evolui (as suítes Robot dependem das rotas e ids dele).

## Como rodar

### Banco (PostgreSQL, `127.0.0.1:5432`)
```bash
cp .env.example .env   # na raiz; defina POSTGRES_PASSWORD (ex.: openssl rand -hex 24)
docker compose up -d db
```
Em `backend/.env`, `DATABASE_URL` e `DIRECT_URL` = `postgresql://baluarte:<POSTGRES_PASSWORD>@localhost:5432/baluarte?schema=public` (ver `backend/.env.example`).

### Backend (`:8080`)
```bash
cd backend
npm install
npm run db:migrate     # aplica as migrations (prisma/migrations) e gera o Prisma Client
npm run seed           # dados de contrato (usuários + ativos que os testes esperam)
npm run seed:demo      # (opcional) dados de demonstração p/ o dashboard ter conteúdo
npm run dev            # sobe a API em http://localhost:8080
```

### Frontend do produto (`:5173`)
```bash
cd baluarte-frontend
npm install
npm run dev                          # camada MOCK (sem backend): explore os três perfis
VITE_USE_MOCKS=false npm run dev     # contra o backend real em :8080
```
Detalhes (scripts, variáveis, modos, suítes) em [`baluarte-frontend/README.md`](baluarte-frontend/README.md).

### Frontend legado (`:3000`, só para as suítes Robot)
```bash
cd frontend
npm install
npm run dev
```

### Credenciais de teste
| E-mail | Senha | Perfil | Onde existe |
|---|---|---|---|
| `admin@empresa.com` | `Admin@123` | Administrador | seed do backend e mocks do frontend |
| `analista@empresa.com` | `Senha@123` | Analista | seed do backend e mocks do frontend |
| `colaborador@empresa.com` | `Colab@123` | Colaborador | seed do backend e mocks do frontend (é o destinatário das campanhas do Newman e do Robot) |
| `ana.souza@empresa.com`, `edson@empresa.com`, … | `Mudar@123` | vários | `seed:demo` do backend (senha fixa só dos usuários de demonstração; contas criadas pelo administrador não têm senha provisória: recebem um convite por e-mail) |

## Testes

| Suíte | Onde | Como rodar | Resultado esperado |
|---|---|---|---|
| **API — integração + pentest** (node:test, um banco Postgres isolado por arquivo) | `backend/tests/` | `cd backend && npm test` (precisa do Postgres local no ar) | 289 testes. Unidade (57, em `tests/unidade/`, sem banco nem servidor: CVSS 3.1, catálogo, varredura, validações, política de senha, tokens, JWT/RBAC, erro de negócio, métricas de campanha, treinamento, e-mails). Banco (7): restrições CHECK, `citext`, cascata/restrição. Integração (112): treinamentos consolidados, campos agregados de ativos, contrato, e-mail simulado da campanha e reporte de e-mail suspeito, ciclo da varredura simulada e uma varredura por vez no ativo, cadastro por convite, reenvio e verificação do link, logout no servidor, renovação de sessão, bloqueio de login guardado no banco, auditoria do login, RBAC por perfil, conta inativada, limite de login, senha, redefinição, notificações, treinamento (navegação interna e link do e-mail), usuários, "Risco aceito", campanhas (só destinatário cadastrado, unicidade, histórico, resultado por departamento), CVSS 3.1 calculado do vetor, catálogo do scanner (CWE/CVE/remediação), departamentos. Segurança (113, em `tests/seguranca/`): injeção (SQLi/NoSQL/prototype pollution/mass assignment), autorização (token forjado/alg=none/IDOR/escalada), força bruta e enumeração, validação de entrada e exposição de informação (CORS, cabeçalhos, vazamento de segredos, RBAC no payload) |
| **API — Postman/Newman** (N2 AT1) | `testes-api/` | ver abaixo | 35 requisições / 70 asserções, 0 falhas |
| **UI — Robot + Selenium** (N2 AT1) | `e2e/*.robot` | ver abaixo | 29 testes, 0 falhas |
| **Frontend — unitários, componentes, a11y** (Vitest + RTL + axe) | `baluarte-frontend/src/__tests__/` | `cd baluarte-frontend && npm test` | 340 testes |
| **Frontend — ponta a ponta** (Playwright, modo mock, desktop + mobile) | `baluarte-frontend/e2e/` | `cd baluarte-frontend && npm run test:e2e` | 32 testes |
| **Frontend — ponta a ponta em modo real** | `baluarte-frontend/e2e/real-backend.spec.ts` | `E2E_REAL=1 E2E_BASE_URL=http://localhost:8081 npx playwright test e2e/real-backend.spec.ts` (stack Docker; em dev use `:5174` com `VITE_USE_MOCKS=false`) | 10 testes |

### Cobertura e relatório de testes (roteiro 3.2)

```bash
cd backend && npm run test:unidade      # só os 57 testes de unidade (sem banco, < 1 s)
cd backend && npm run test:relatorio    # cobertura de unidade + completa e coverage/RELATORIO.md
cd baluarte-frontend && npm run test:coverage
```

O `test:relatorio` mede a cobertura com o c8 e escreve `backend/coverage/RELATORIO.md` com testes, aprovados, falhas, **taxa de sucesso** e **% de linhas, ramos e funções** de cada suíte (relatório por arquivo em `coverage/index.html`). Metas mínimas (o comando falha abaixo delas): unidade 75% linhas / 85% ramos / 70% funções; completa 90% / 85% / 90%; frontend 80% / 75% / 60%.

| Suíte | Testes | Taxa de sucesso | Linhas | Ramos | Funções |
|---|---:|---:|---:|---:|---:|
| Backend — unidade | 57 | 100% | 83,9% | 94,2% | 78,2% |
| Backend — completa (unidade + integração + pentest) | 289 | 100% | 98,8% | 95,3% | 99,0% |
| Frontend (Vitest) | 340 | 100% | 84,1% | 79,9% | 63,2% |

As funções do frontend (63,2%) estão abaixo dos 70% do RNF-08; linhas e ramos estão acima.

### API — Postman/Newman (contra o backend real)
A collection da N2 AT1 (`testes-api/`) roda **35 requisições / 70 asserções** sobre os 6 endpoints do contrato. Rode com a base de contrato (sem dados de demo) para garantir o verde:
```bash
cd backend && npm run db:reset && npm run seed && npm run dev   # banco limpo de contrato (reinicie a API depois de um db:reset)
npx newman run testes-api/Baluarte-N2AT1.postman_collection.json -e testes-api/Baluarte-local.postman_environment.json
# => 70 assertions, 0 failed
```

### UI — Robot Framework + Selenium (contra o frontend legado)
As 6 suítes da N2 AT1 estão em `e2e/`, idênticas às originais **exceto a URL base** (apontam para as rotas reais do SPA legado em `:3000`, sem `.html`). Precisam de **banco limpo** (o CT01 de ativo cadastra `10.0.0.5`; numa segunda execução ele viraria "Ativo já cadastrado"). Com backend e `frontend/` no ar:
```bash
python -m robot --outputdir e2e/resultados e2e/*.robot
# => 29 tests, 29 passed, 0 failed
```
Relatórios em `e2e/resultados/report.html` e `log.html`.

## Endpoints (sob `/api`)

**Contrato (testado pelo Postman — não muda):** `POST /login` · `POST /scans` · `POST /assets` · `POST /users` · `POST /campaigns` (aceita também `destinatarios[]`) · `GET /findings/classificacao?cvss=`

**Leitura (alimentam as telas):** `GET /me` · `GET /dashboard` · `GET /assets` · `GET /scans` · `GET /vulnerabilidades[/:id]` (+ `PATCH`, inclusive status `Risco aceito`) · `GET /campanhas[/:id]` · `GET /usuarios` (com `departamento`) · `GET /departamentos` (Administrador/Analista) · `GET /configuracoes/seguranca` · `GET /treinamentos/:token` (protegido: o `:token` é o id do evento; Colaborador só o próprio)

**Achados:** cada vulnerabilidade traz `cwe`, `cve` (só em achado de componente), `cvssVetor` e `remediacao` (passos numerados com título, descrição e esforço). A nota `cvss` é calculada do vetor CVSS 3.1 (`src/cvss.ts`) e a severidade sai da nota; o scanner simulado sorteia tipos do catálogo em `src/catalogo.ts`.

**Varreduras:** `POST /scans` responde `EM_FILA` (contrato); o status avança pelo tempo decorrido — em fila nos primeiros 5 s, em andamento até 20 s, concluída depois — e é gravado na primeira leitura de `GET /scans`, `/dashboard` ou `/vulnerabilidades` que perceber a mudança (sem processo em segundo plano, o que funciona também na função serverless). Os achados só aparecem quando a varredura conclui. Um ativo só recebe nova varredura depois que a anterior conclui (`409 VARREDURA_EM_ANDAMENTO`, RN-003). A tela **Varreduras** (`/scans`) do frontend inicia e acompanha, consultando a API a cada 3 s enquanto houver varredura em curso. Usuários aceitam `departamento` (pelo nome) em `POST /users` e `PATCH /users/:id`; o relatório da campanha traz `porDepartamento`.

**E-mail simulado da campanha e seus links (públicos, sem login):** `POST /campaigns` envia a cada destinatário o e-mail do template (`urgencia`, `autoridade`, `curiosidade`; `src/campanhaEmail.ts`) com dois links para o frontend: `/t/<token>` (abre o treinamento) e `/t/<token>/reportar` (confirma o reporte). A resposta ganha `emailsEnviados`; só quem recebeu fica com `enviadoEm`. `GET /treinamentos/link/:token` (registra abertura e clique uma vez e entrega o treinamento, sem expor ids nem a campanha) · `POST /treinamentos/link/:token/concluir` · `POST /treinamentos/link/:token/reportar` (registra `reportouEm` e a abertura, sem clique; idempotente; `404 LINK_NAO_ENCONTRADO`). O relatório `GET /campanhas/:id` traz `reportes[]` e o funil `reportaram`. O token é aleatório (256 bits), gerado por destinatário ao criar a campanha, e no banco fica só o hash SHA-256. `POST /campaigns` só aceita destinatário cadastrado e não inativo (`422 DESTINATARIO_NAO_CADASTRADO`, conferido depois de formato e domínio).

**Conta e administração:** `POST /users` cria a conta `Pendente`, sem senha, e envia um **convite** por e-mail (link de 72 h para a pessoa criar a própria senha; conta pendente não entra por login) · `POST /users/:id/convite` (reenvia; Administrador/Analista) · `POST /users/:id/redefinir-senha` (Administrador envia o link de redefinição a uma conta ativa; não gasta o limite de pedidos do dono e audita quem pediu) · `POST /auth/link/verificar` (a tela confere o link antes de pedir a senha) · `POST /auth/change-password` (encerra as outras sessões e devolve um token novo para a atual) · `POST /auth/reset-password` (+ `/confirm`, que também aceita o convite e recusa a senha atual com `400 SENHA_REPETIDA`; link de uso único com validade de 30 min, 3 solicitações por e-mail a cada 15 min; redefinir encerra as sessões abertas antes e tira a conta do bloqueio) · `POST /auth/logout` (invalida os tokens emitidos antes, em todos os dispositivos) · `POST /auth/renovar` (sessão expira com 30 min sem uso; teto de 8 h desde o login) · `GET/PUT /configuracoes/notificacoes` · `POST /treinamentos/:token/concluir` · `PATCH/DELETE /users/:id` (Administrador; protege a própria conta e o último administrador ativo; quem tem histórico de campanha não é excluído, só inativado) · `DELETE /campanhas/:id` (Administrador/Analista) · `POST /departamentos` e `DELETE /departamentos/:id` (Administrador; departamento com usuários não é excluído)

Erros seguem o envelope `{ status: "erro", mensagem, codigoErro, timestamp }`; sucessos, `{ status: "sucesso", mensagem?, dados, resumo? }`. Toda rota de escrita fora do contrato registra em `AuditLog`.

As suítes de segurança em `backend/tests/seguranca/` exercitam a API com payloads reais (injeção, tokens adulterados, força bruta, corpos malformados); os achados que elas revelaram foram corrigidos no backend (coerção de query string, validação de tipo em campos obrigatórios, senha só como string, corpo grande com envelope 413, e o dashboard do colaborador sem métricas por campanha — RN-006).

### RBAC efetivo (verificado no servidor, não só na interface)

| Perfil | Pode |
|---|---|
| **Administrador** | tudo, inclusive `GET /usuarios` e `PATCH/DELETE /users/:id` |
| **Analista** | operar a plataforma (varreduras, ativos, campanhas, status de vulnerabilidade, criar Analista/Colaborador) e ler as listas técnicas; **não** lista nem edita usuários |
| **Colaborador** | `GET /me`, `GET /dashboard` (só índices e KPIs, sem a lista de achados), `GET /configuracoes/seguranca`, as próprias notificações e o próprio treinamento |

O perfil vem do banco a cada requisição (um token emitido antes de um rebaixamento deixa de valer), contas `Inativo` perdem o acesso na hora (401 `USUARIO_INATIVO`) e o login de conta inativa é recusado (403 `USUARIO_INATIVO`). O login bloqueia após 5 falhas por conta em 15 minutos (429 `MUITAS_TENTATIVAS`), como a política de `GET /configuracoes/seguranca` anuncia.

> Efeito colateral no frontend legado: a tela `/usuarios` dele agora precisa de um token de **Administrador** (com o analista do seed ela mostra "Erro ao carregar usuários"). As 6 suítes Robot não passam por essa tela — os formulários que elas exercitam validam no próprio navegador.

### Limitações conhecidas (decisões conscientes de escopo)

- **E-mail só para Mailpit.** Convite e redefinição de senha saem por SMTP para o Mailpit do Compose (caixa em `http://localhost:8025`); em produção é preciso configurar `SMTP_HOST` com um servidor real. Sem SMTP, fora de produção, o e-mail inteiro vai para o log da API; em produção sem SMTP nada é enviado. O e-mail simulado da campanha segue a mesma regra (o `TREINAMENTO_LINK_CONSOLE` saiu): sem SMTP em dev o e-mail inteiro, com o link, vai para o log; em produção sem SMTP nada sai e o link nunca é impresso.
- **Phishing simulado, não um teste cego.** O rodapé do e-mail diz que é simulação, então mede reconhecimento e hábito de reportar mais do que "cair" num golpe realista. Só texto: **não há pixel de abertura** (a abertura é registrada no clique ou no reporte). O envio é síncrono, em sequência, dentro do `POST /campaigns` — adequado a campanhas internas pequenas; com SMTP fora do ar cada destinatário espera o timeout (5 s) e a campanha é criada mesmo assim (`emailsEnviados` menor). Abrir `/t/<token>` registra o clique no carregamento da página: um antivírus que pré-visite links pode contar um clique falso (o reporte, por isso, exige confirmação).
- **Trocar a própria senha** (`/auth/change-password`) não derruba as outras sessões do mesmo usuário; a redefinição por token, sim. Todo token expira em 30 minutos.

## Supabase (banco hospedado para a demonstração)

O backend fala com qualquer PostgreSQL; o Supabase (plano gratuito) serve de banco hospedado para a apresentação. Desenvolvimento e testes continuam no Postgres local do Docker: os testes recriam bancos e o Newman exige banco limpo, o que apagaria os dados da demonstração e gastaria a cota.

1. No Supabase, use o projeto do Baluarte (o `frontend/` legado já aponta para um) ou crie um. **Project Settings → Database → Connection string.**
2. Em `backend/.env` (nunca no git), troque as duas URLs:
   - `DATABASE_URL` = **Transaction pooler** (porta `6543`) + `?pgbouncer=true&connection_limit=1` — é a conexão da API.
   - `DIRECT_URL` = **Session pooler** (porta `5432`) — usada só pelas migrations (a conexão direta do plano gratuito é só IPv6).
3. `cd backend && npm run db:migrate && npm run seed && npm run seed:demo`.
4. **Não rode `npm test` com essas URLs**: o helper dos testes recusa servidor não local de propósito.

Cuidados do plano gratuito: 500 MB por projeto, no máximo 2 projetos gratuitos por organização e **pausa após 7 dias sem uso** — restaure o projeto no painel antes da apresentação. O Supabase hospeda só o banco: a API ainda precisa rodar em algum lugar (máquina local, Docker ou um serviço como Render/Railway).

## Docker

Com o Docker Desktop no ar (pare os `npm run dev` antes — as portas são as mesmas):
```bash
cp .env.example .env                       # opcional: JWT_SECRET e SEED_DEMO
docker compose up --build -d backend app   # API :8080 + frontend do produto :8081 (Nginx)
docker compose up --build -d               # idem + frontend legado :3000 (para as suites Robot)
# convites e links de redefinicao chegam na caixa do Mailpit: http://localhost:8025
docker compose down                        # -v tambem apaga o banco (volume db-data)
```
- O frontend do produto fica em **:8081** no Docker, e nao em 5173: a 5173 e do dev server do Vite (que o Playwright reutiliza quando esta ocupada), entao os dois modos convivem sem se confundir.
- Os dados ficam no PostgreSQL do servico `db` (volume `db-data`), publicado so em `127.0.0.1:5432`. A senha vem de `POSTGRES_PASSWORD` no `.env` da raiz; sem ela o compose nao sobe. Na **primeira** subida o entrypoint aplica as migrations (`prisma migrate deploy`, que nunca apaga dados), roda o seed de contrato e o `seed:demo` (`SEED_DEMO=0` desliga); nas seguintes so aplica migrations pendentes e o seed de contrato (idempotente).
- **Depois de um `db:reset` com a API no ar, reinicie a API** (`docker compose restart backend`): o reset recria a extensao `citext` e as conexoes abertas ficam com o tipo antigo em cache (`cache lookup failed for type`).
- **Sem segredo no repositorio:** se `JWT_SECRET` nao vier do `.env`, o entrypoint gera um aleatorio e o guarda no volume (`/data/jwt.secret`), entao as sessoes sobrevivem a reinicios sem nenhum valor fixo versionado. Com `NODE_ENV=production` a API se recusa a subir sem um segredo forte.
- `app` faz o build de producao de `baluarte-frontend/` e o serve com Nginx, encaminhando `/api` para o servico `backend` (`baluarte-frontend/nginx.conf`); so sobe depois do healthcheck da API. A API roda como usuario `node`, nao como root.
- Para as suites Newman/Robot contra o Docker, suba com um banco limpo: `docker compose down -v && SEED_DEMO=0 docker compose up --build -d`.

## Estrutura

```
backend/            API real (Express + Prisma/PostgreSQL)
  prisma/           schema + seed (contrato) + seed-demo
  src/http/         app, servidor, roteador, middlewares (token e perfil) e envelope de resposta
  src/platform/     Prisma, e-mail (SMTP/Mailpit) e tokens de link
  src/shared/       validações de entrada e constantes de domínio
  src/modules/      um módulo por domínio (routes → service → repository): auth, users, departments,
                    assets, scanner, reports, campaigns, training, dashboard, notifications, audit
  tests/            unidade (tests/unidade, sem banco) + integração e pentest (node:test) com banco isolado
baluarte-frontend/  SPA React do produto (mocks ou backend real) — ver README próprio
frontend/           SPA legado (telas do Figma) — alvo das suítes Robot
e2e/                6 suítes Robot apontando para o frontend legado
testes-api/         collection + environment do Postman
testes/             materiais originais da N2 AT1 (stubs, evidências)
```
