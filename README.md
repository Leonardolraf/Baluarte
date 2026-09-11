# Baluarte V2

Plataforma web de **segurança ofensiva e conscientização** (TCC de Engenharia de Software — UCB), construída como sistema **real** para a disciplina de **Teste de Software**: backend + frontend de verdade, contra os quais rodam as suítes de teste de API (Postman/Newman) e de UI (Robot Framework + Selenium) da N2 AT1 — não mais contra stubs.

> ⚠️ **Escopo honesto:** a *plataforma* é real (autenticação JWT, RBAC, persistência, dashboard com agregações reais, trilha de auditoria). O **scanner OWASP** e o **disparo de phishing** são **simulados no servidor** (criar varredura gera achados realistas; criar campanha registra e simula rastreamento) — nenhum ataque real é executado e nenhum e-mail é enviado (o token de redefinição de senha é impresso no console do backend fora de produção).

## Arquitetura

| Camada | Pasta | Stack | Porta |
|---|---|---|---|
| **API** | `backend/` | Node + Express + TypeScript + Prisma + SQLite · JWT (HS256) + bcrypt · RBAC · AuditLog | `8080` |
| **Frontend (produto)** | `baluarte-frontend/` | React 18 + Vite + TypeScript + TailwindCSS · RBAC por rota · tema claro/escuro · camada mock ou backend real | `5173` |
| **Frontend legado** | `frontend/` | React 18 + Vite (telas geradas do Figma) — mantido **só** como alvo das suítes Robot da N2 AT1 | `3000` |

Os dois frontends fazem proxy de `/api` → `http://localhost:8080`. Novas telas e funcionalidades vão em `baluarte-frontend/`; `frontend/` não evolui (as suítes Robot dependem das rotas e ids dele).

## Como rodar

### Backend (`:8080`)
```bash
cd backend
npm install
npm run db:push        # cria o SQLite e o Prisma Client
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
| `colaborador@empresa.com` | `Colab@123` | Colaborador | só nos mocks do frontend |
| `ana.souza@empresa.com`, `edson@empresa.com`, … | `Mudar@123` | vários | `seed:demo` do backend (senha provisória de contas criadas pelo administrador) |

## Testes

| Suíte | Onde | Como rodar | Resultado esperado |
|---|---|---|---|
| **API — integração** (node:test, SQLite isolado `test.db`) | `backend/tests/` | `cd backend && npm test` | 27 testes: contrato (smoke), senha, redefinição, notificações, treinamento, usuários, "Risco aceito", campanhas com vários destinatários |
| **API — Postman/Newman** (N2 AT1) | `testes-api/` | ver abaixo | 35 requisições / 70 asserções, 0 falhas |
| **UI — Robot + Selenium** (N2 AT1) | `e2e/*.robot` | ver abaixo | 29 testes, 0 falhas |
| **Frontend — unitários, componentes, a11y** (Vitest + RTL + axe) | `baluarte-frontend/src/__tests__/` | `cd baluarte-frontend && npm test` | 320+ testes |
| **Frontend — ponta a ponta** (Playwright, modo mock, desktop + mobile) | `baluarte-frontend/e2e/` | `cd baluarte-frontend && npm run test:e2e` | 32 testes |
| **Frontend — ponta a ponta em modo real** | `baluarte-frontend/e2e/real-backend.spec.ts` | `E2E_REAL=1 E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/real-backend.spec.ts` (frontend em `VITE_USE_MOCKS=false`, backend no ar) | 8 testes |

### API — Postman/Newman (contra o backend real)
A collection da N2 AT1 (`testes-api/`) roda **35 requisições / 70 asserções** sobre os 6 endpoints do contrato. Rode com a base de contrato (sem dados de demo) para garantir o verde:
```bash
cd backend && npm run db:reset && npm run seed && npm run dev   # banco limpo de contrato
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

**Leitura (alimentam as telas):** `GET /me` · `GET /dashboard` · `GET /assets` · `GET /scans` · `GET /vulnerabilidades[/:id]` (+ `PATCH`, inclusive status `Risco aceito`) · `GET /campanhas[/:id]` · `GET /usuarios` · `GET /configuracoes/seguranca` · `GET /treinamentos/:token`

**Conta e administração:** `POST /auth/change-password` · `POST /auth/reset-password` (+ `/confirm`, token de uso único com validade de 30 min, 3 solicitações por e-mail a cada 15 min) · `GET/PUT /configuracoes/notificacoes` · `POST /treinamentos/:token/concluir` · `PATCH/DELETE /users/:id` (Administrador; protege a própria conta e o último administrador ativo)

Erros seguem o envelope `{ status: "erro", mensagem, codigoErro, timestamp }`; sucessos, `{ status: "sucesso", mensagem?, dados, resumo? }`. Toda rota de escrita fora do contrato registra em `AuditLog`.

## Supabase (opcional)

O cliente Supabase está configurado em `frontend/src/supabase.ts` (lê `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do `.env` — a chave **anon** é pública). Conectividade já verificada (auth/REST respondem 200).

> ⚠️ O projeto Supabase ainda **não tem tabelas**, então não há dados a ler/gravar via REST até criá-las.

**Para usar o Postgres do Supabase como banco real do backend** (ver `backend/.env.example`):
1. `backend/prisma/schema.prisma` → `provider = "postgresql"`.
2. `backend/.env` → `DATABASE_URL` = connection string do Supabase (Project Settings → Database). **A senha é secreta** (só no seu `.env`).
3. `npm run db:push` cria todas as tabelas no Supabase automaticamente; depois `npm run seed`.

## Docker

Com o Docker Desktop no ar (pare os `npm run dev` antes — as portas são as mesmas):
```bash
cp .env.example .env                       # opcional: JWT_SECRET e SEED_DEMO
docker compose up --build -d backend app   # API :8080 + frontend do produto :5173 (Nginx)
docker compose up --build -d               # idem + frontend legado :3000 (para as suítes Robot)
docker compose logs -f backend             # aqui aparecem os tokens de redefinição de senha
docker compose down                        # -v também apaga o banco (volume backend-data)
```
- O SQLite da API vive no volume `backend-data` (`/data/dev.db`): sobrevive a `down`/`up` e a rebuilds. Na **primeira** subida o entrypoint aplica o schema, roda o seed de contrato e o `seed:demo` (`SEED_DEMO=0` desliga); nas seguintes só reaplica o schema e o seed de contrato (idempotente), sem apagar o que foi criado pela interface.
- `app` faz o build de produção de `baluarte-frontend/` e o serve com Nginx, encaminhando `/api` para o serviço `backend` (`baluarte-frontend/nginx.conf`); só sobe depois do healthcheck da API.
- Para as suítes Newman/Robot contra o Docker, suba com um banco limpo: `docker compose down -v && SEED_DEMO=0 docker compose up --build -d`.

## Estrutura

```
backend/            API real (Express + Prisma/SQLite)
  prisma/           schema + seed (contrato) + seed-demo
  src/              app, auth (JWT/RBAC), audit, util (validações = contrato), routes/ (api = contrato · read · manage)
  tests/            testes de integração (node:test) com banco isolado
baluarte-frontend/  SPA React do produto (mocks ou backend real) — ver README próprio
frontend/           SPA legado (telas do Figma) — alvo das suítes Robot
e2e/                6 suítes Robot apontando para o frontend legado
testes-api/         collection + environment do Postman
testes/             materiais originais da N2 AT1 (stubs, evidências)
```
