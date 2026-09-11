# CLAUDE.md — Baluarte (código)

> Este é o repositório de código (`github.com/Leonardolraf/Baluarte`, branch `main`).
> **Contexto completo do projeto, convenções e fonte de verdade da documentação:** `C:\Users\Leo\Desktop\Baluarte\CLAUDE.md` — leia antes de mexer aqui.
> **Wiki do GitHub:** `C:\Users\Leo\Desktop\Baluarte\Baluarte.wiki` (clone local, git próprio).

## O que tem aqui
App real construído para a disciplina de Teste de Software do TCC (não mais stubs):
- `backend/` — Node + Express + TypeScript + Prisma + SQLite, JWT (HS256) + bcrypt, RBAC. Porta `8080`. Testes de integração próprios em `backend/tests/` (`npm test`, banco `test.db` isolado).
- `baluarte-frontend/` — **frontend do produto**: SPA React 18 + TypeScript + Vite + TailwindCSS com RBAC por rota, tema claro/escuro, camada mock (`npm run dev`) ou backend real (`VITE_USE_MOCKS=false`). Porta `5173`. Suítes: Vitest + RTL + axe (`npm test`), Playwright (`npm run test:e2e`; modo real com `E2E_REAL=1`).
- `frontend/` — **frontend legado** (telas geradas do Figma). Porta `3000`. Mantido só como alvo das suítes Robot Framework da N2 AT1 (`e2e/*.robot`), que dependem das rotas `/cadastro-usuario`, `/cadastro-ativo`, `/campanha`, `/alterar-senha`, `/reset-senha` e dos ids dos formulários. Não evoluir; novas telas vão em `baluarte-frontend/`.
- `testes-api/` e `testes/api/` — collection Postman/Newman (N2 AT1): 35 requisições / 70 asserções sobre os 6 endpoints do contrato. Precisa de banco limpo (`db:reset` + `seed`).
- `testes/ui/` e `e2e/` — Robot Framework + Selenium (N2 AT1): 29 testes contra `frontend/` em `:3000`. Também precisam de banco limpo (o CT01 de ativo cadastra `10.0.0.5`).

Ver `README.md` deste repo para como rodar, credenciais de teste e como rodar cada suíte.

**Escopo honesto:** a plataforma (auth, RBAC, persistência, dashboard) é real. O scanner OWASP e o disparo de phishing são **simulados no servidor** — nenhum ataque real, nenhum e-mail é enviado de fato (o token de redefinição de senha é impresso no console do backend fora de produção).

## Regras do contrato
- As 6 rotas testadas pelo Postman (`POST /login`, `/scans`, `/assets`, `/users`, `/campaigns`, `GET /findings/classificacao`) e as mensagens/códigos de erro em `backend/src/util.ts` **não mudam** — só se estendem de forma compatível (ex.: `destinatarios[]` além de `destinatario` em `/campaigns`).
- Rotas novas de leitura vão em `backend/src/routes/read.ts`; de escrita, em `backend/src/routes/manage.ts`. Toda rota de escrita registra em `AuditLog` (`src/audit.ts`).
- O frontend fala com o backend só por `baluarte-frontend/src/services/api.ts` + `adapters.ts` (envelope `{ status, dados, resumo }`, campos em português → modelos de domínio em inglês).

## Segurança
Nunca deixar segredo hardcoded (chave/token/senha) no código — usar `.env` (fora do git; ver `.env.example` em `backend/`, `frontend/` e `baluarte-frontend/`). Senhas só com bcrypt; tokens de redefinição só como hash SHA-256 no banco.
