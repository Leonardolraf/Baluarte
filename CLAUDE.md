# CLAUDE.md — Baluarte (código)

> Este é o repositório de código (`github.com/Leonardolraf/Baluarte`, branch `main`).
> **Contexto completo do projeto, convenções e fonte de verdade da documentação:** `C:\Users\Leo\Desktop\Baluarte\CLAUDE.md` — leia antes de mexer aqui.
> **Wiki do GitHub:** `C:\Users\Leo\Desktop\Baluarte\Baluarte.wiki` (clone local, git próprio).

## O que tem aqui
App real construído para a disciplina de Teste de Software do TCC (não mais stubs):
- `backend/` — Node + Express + TypeScript + Prisma + **PostgreSQL 16** (serviço `db` do compose, `127.0.0.1:5432`), JWT (HS256) + bcrypt, RBAC, AuditLog. Porta `8080`. Testes em `backend/tests/` (`npm test`, 221 testes — 7 de banco, 101 de integração, 113 de pentest em `tests/seguranca/` —, um banco `baluarte_test_<arquivo>` por arquivo, recriado pelas migrations; só roda contra Postgres local).
- `baluarte-frontend/` — **frontend do produto**: SPA React 18 + TypeScript + Vite + TailwindCSS com RBAC por rota, tema claro/escuro, camada mock (`npm run dev`) ou backend real (`VITE_USE_MOCKS=false`). Porta `5173`. Suítes: Vitest + RTL + axe (`npm test`), Playwright (`npm run test:e2e`; modo real com `E2E_REAL=1`).
- `frontend/` — **frontend legado** (telas geradas do Figma). Porta `3000`. Mantido só como alvo das suítes Robot Framework da N2 AT1 (`e2e/*.robot`), que dependem das rotas `/cadastro-usuario`, `/cadastro-ativo`, `/campanha`, `/alterar-senha`, `/reset-senha` e dos ids dos formulários. Não evoluir; novas telas vão em `baluarte-frontend/`.
- `testes-api/` e `testes/api/` — collection Postman/Newman (N2 AT1): 35 requisições / 70 asserções sobre os 6 endpoints do contrato. Precisa de banco limpo (`db:reset` + `seed`, e reiniciar a API depois do reset).
- `testes/ui/` e `e2e/` — Robot Framework + Selenium (N2 AT1): 29 testes contra `frontend/` em `:3000`. Também precisam de banco limpo (o CT01 de ativo cadastra `10.0.0.5`).

Ver `README.md` deste repo para como rodar, credenciais de teste e como rodar cada suíte.

**Escopo honesto:** a plataforma (auth, RBAC, persistência, dashboard) é real. O scanner OWASP e o phishing são **simulados** — nenhum ataque real. A campanha envia um e-mail simulado por destinatário (`src/campanhaEmail.ts`: texto do template, rodapé identificando a simulação, links só para o frontend: `/t/<token>` treinamento e `/t/<token>/reportar`). Esse e-mail e os de conta (convite e redefinição de senha) saem por SMTP para o Mailpit do Compose (`:8025`), via `src/email.ts`; nos testes, para a caixa em memória `caixaDeSaida`; em produção sem SMTP, nada sai nem é impresso.
- **Conta:** não existe senha provisória. `POST /users` cria a conta `Pendente` com hash de senha descartável e envia um convite (`src/conta.ts`, token tipo `CONVITE`, 72 h); conta `Pendente` não entra por login. Logout grava `sessaoEncerradaEm`; falhas de login ficam na tabela `LoginFailure`. Nos testes, `criarUsuario` aceita o convite com `SENHA_CONTA`; `criarUsuarioPendente` para antes.

## Regras do contrato
- As 6 rotas testadas pelo Postman (`POST /login`, `/scans`, `/assets`, `/users`, `/campaigns`, `GET /findings/classificacao`) e as mensagens/códigos de erro em `backend/src/util.ts` **não mudam** — só se estendem de forma compatível (ex.: `destinatarios[]` além de `destinatario` em `/campaigns`).
- Rotas novas de leitura vão em `backend/src/routes/read.ts`; de escrita, em `backend/src/routes/manage.ts`. Toda rota de escrita registra em `AuditLog` (`src/audit.ts`).
- O frontend fala com o backend só por `baluarte-frontend/src/services/api.ts` + `adapters.ts` (envelope `{ status, dados, resumo }`, campos em português → modelos de domínio em inglês).
- **RBAC é do servidor:** `exigeToken` carrega o usuário do banco a cada requisição (perfil atual, conta removida/inativa, senha redefinida) e `exigePerfil` decide pelo perfil do banco, não pelo que está no JWT. Administrador gerencia usuários; Analista opera a plataforma e lê as listas técnicas; Colaborador só vê índices, KPIs, política e o próprio treinamento. Ver a tabela no `README.md`.
- **Campanha ↔ usuário:** `CampaignEvent.userId` é obrigatório (só destinatário cadastrado e não inativo), com unicidade (`campaignId`, `userId`); usuário com histórico de campanha não é excluído (`USUARIO_COM_HISTORICO`). O dono do treinamento é decidido pelo `userId`, nunca pelo e-mail.
- **Dois acessos ao treinamento:** dentro do sistema, `/treinamentos/:token` usa o id do evento e exige login; o link do e-mail usa `/treinamentos/link/:token` (e `/reportar`, POST público e idempotente), com token aleatório guardado só como hash (`src/tokens.ts`, o mesmo do reset de senha). No frontend, as rotas públicas `/t/:token` e `/t/:token/reportar` consomem esses endpoints.
- **Achados:** a nota CVSS sai do vetor (`src/cvss.ts`), nunca é digitada; tipos de falha, CWE, CVE e remediação ficam no catálogo `src/catalogo.ts` e são copiados para o `Finding` no momento do achado. `remediacao` é `Json` (JSONB).
- **Varredura simulada (B21):** status por tempo decorrido, avaliado e gravado na leitura (`src/varredura.ts`: `EM_FILA` 5 s → `EM_ANDAMENTO` até 20 s → `CONCLUIDA`), sem timer em segundo plano (a API também roda serverless). Os achados nascem só na conclusão. `POST /scans` continua respondendo `EM_FILA` e recusa nova varredura no mesmo ativo enquanto a anterior não conclui (`409 VARREDURA_EM_ANDAMENTO`, RN-003).
- **Idioma do banco:** os campos são em português, exceto o modelo `Department` (`name`, `createdAt`) e `User.departmentId`, por decisão do projeto. A API continua em português (`departamento`).
- **Banco:** mudança de schema só por migration (`npm run db:migrate:dev -- --name <nome>`), nunca `db push`. Valores fixos (perfil, status, tipo, severidade, template) são texto com restrição **CHECK** escrita à mão na migration (o Prisma não modela CHECK; `migrate diff` confirma que ele não tenta removê-las) — mudar uma lista de `src/util.ts` exige migration nova. E-mail e nome de departamento são `citext`. Caractere NUL é barrado na borda (`src/app.ts`), porque o Postgres o recusa.
- **Docker:** `docker compose up --build -d` sobe Postgres, API `:8080`, frontend do produto `:8081` (Nginx) e legado `:3000`. Dados no volume `db-data`; `POSTGRES_PASSWORD` vem do `.env` da raiz (obrigatória). O `JWT_SECRET`, quando não vem do `.env`, é gerado no volume `backend-data`. Nenhum segredo fixo vai para o repositório.
- **Supabase:** banco hospedado só para a demonstração (ver README); desenvolvimento e testes no Postgres local.

## Segurança
Nunca deixar segredo hardcoded (chave/token/senha) no código — usar `.env` (fora do git; ver `.env.example` em `backend/`, `frontend/` e `baluarte-frontend/`). Senhas só com bcrypt; tokens de redefinição só como hash SHA-256 no banco.
