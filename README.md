# Baluarte V2

Plataforma web de **segurança ofensiva e conscientização** (TCC de Engenharia de Software — UCB), construída como sistema **real** para a disciplina de **Teste de Software**: backend + frontend de verdade, contra os quais rodam as suítes de teste de API (Postman/Newman) e de UI (Robot Framework + Selenium) da N2 AT1 — não mais contra stubs.

> ⚠️ **Escopo honesto:** a *plataforma* é real (autenticação JWT, RBAC, persistência, dashboard com agregações reais). O **scanner OWASP** e o **disparo de phishing** são **simulados no servidor** (criar varredura gera achados realistas; criar campanha registra e simula rastreamento) — nenhum ataque real é executado e nenhum e-mail é enviado. É o suficiente para exercitar e testar a superfície da aplicação.

## Arquitetura

| Camada | Stack | Porta |
|---|---|---|
| **backend/** | Node + Express + TypeScript + Prisma + SQLite · JWT (HS256) + bcrypt · RBAC | `8080` |
| **frontend/** | React 18 + Vite + TypeScript + TailwindCSS (telas geradas do Figma) | `3000` |

O frontend faz proxy de `/api` → `http://localhost:8080`.

## Como rodar

### Backend (`:8080`)
```bash
cd backend
npm install
npm run db:push        # cria o SQLite e o Prisma Client
npm run seed           # dados de contrato (usuário + ativos que os testes esperam)
npm run seed:demo      # (opcional) dados de demonstração p/ o dashboard ter conteúdo
npm run dev            # sobe a API em http://localhost:8080
```

### Frontend (`:3000`)
```bash
cd frontend
npm install
npm run dev            # http://localhost:3000
```

### Credenciais de teste
| E-mail | Senha | Perfil |
|---|---|---|
| `analista@empresa.com` | `Senha@123` | Analista |
| `admin@empresa.com` | `Admin@123` | Administrador |

## Testes

### API — Postman/Newman (contra o backend real)
A collection da N2 AT1 (`testes-api/`) roda **35 requisições / 70 asserções** sobre os 6 endpoints do contrato. Rode com a base de contrato (sem dados de demo) para garantir o verde:
```bash
cd backend && npm run db:reset && npm run seed && npm run dev   # banco limpo de contrato
npx newman run testes-api/Baluarte-N2AT1.postman_collection.json -e testes-api/Baluarte-local.postman_environment.json
# => 70 assertions, 0 failed
```

### UI — Robot Framework + Selenium (contra o app real)
As 6 suítes da N2 AT1 estão em `e2e/`, idênticas às originais **exceto a URL base** (apontam para as rotas reais do SPA, sem `.html`). Com backend e frontend no ar:
```bash
python -m robot --outputdir e2e/resultados e2e/*.robot
# => 29 tests, 29 passed, 0 failed
```
Relatórios em `e2e/resultados/report.html` e `log.html`.

## Endpoints principais (sob `/api`)

**Contrato (testado pelo Postman):** `POST /login` · `POST /scans` · `POST /assets` · `POST /users` · `POST /campaigns` · `GET /findings/classificacao?cvss=`

**Leitura (alimentam as telas):** `GET /me` · `GET /dashboard` · `GET /assets` · `GET /scans` · `GET /vulnerabilidades[/:id]` (+ `PATCH`) · `GET /campanhas[/:id]` · `GET /usuarios` · `GET /configuracoes/seguranca` · `GET /treinamentos/:token`

## Supabase (opcional)

O cliente Supabase está configurado em `frontend/src/supabase.ts` (lê `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do `.env` — a chave **anon** é pública). Conectividade já verificada (auth/REST respondem 200).

> ⚠️ O projeto Supabase ainda **não tem tabelas**, então não há dados a ler/gravar via REST até criá-las.

**Para usar o Postgres do Supabase como banco real do backend** (ver `backend/.env.example`):
1. `backend/prisma/schema.prisma` → `provider = "postgresql"`.
2. `backend/.env` → `DATABASE_URL` = connection string do Supabase (Project Settings → Database). **A senha é secreta** (só no seu `.env`).
3. `npm run db:push` cria todas as tabelas no Supabase automaticamente; depois `npm run seed`.

## Docker

```bash
docker compose up --build    # frontend :3000 + backend :8080
```
*(Compose e Dockerfiles incluídos; não testados neste ambiente por ausência de Docker.)*

## Estrutura

```
backend/   API real (Express + Prisma/SQLite)
  prisma/  schema + seed (contrato) + seed-demo
  src/     app, auth (JWT/RBAC), util (validações = contrato), routes/ (api + read)
frontend/  SPA React (Vite + Tailwind), telas do Figma ligadas à API
  src/pages/        Login, Dashboard, app/ (telas internas), forms/ (telas-formulário)
e2e/       6 suítes Robot apontando para o app real
testes-api/ collection + environment do Postman
```
