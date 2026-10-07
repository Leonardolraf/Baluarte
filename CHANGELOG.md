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

## 2026-10-07 — Migração para PostgreSQL (itens 6 a 8 da revisão do banco)

O DRS pede PostgreSQL e o código usava SQLite. A troca foi feita junto com os itens que dependiam dela.

- **PostgreSQL 16 no Docker Compose** (serviço `db`, porta publicada só em `127.0.0.1`). A senha vem de `POSTGRES_PASSWORD` no `.env` da raiz — sem ela o compose não sobe; nenhuma senha vai para o git. A API, o Newman, o Robot e o Playwright rodam contra ele.
- **Migrations versionadas** (`prisma/migrations/`) no lugar do `db push`: `db:migrate` (aplica), `db:migrate:dev` (cria), `db:reset`. O entrypoint do Docker usa `migrate deploy`, que nunca apaga dados. `directUrl` separado para o Supabase (pooler para a API, conexão de sessão para as migrations).
- **Valores fixos garantidos pelo banco** (item 6) com restrições **CHECK** — perfil, status, tipo de ativo, severidade, template, faixa do CVSS, formato de CWE/CVE/vetor e remediação como lista. Não foram enums do Prisma, como tinha sido proposto: os valores do contrato têm acento e espaço ("Em revisão", "Banco de Dados"), e enum obrigaria traduzir valor em todas as rotas. A garantia no banco é a mesma. Conferido que o Prisma não tenta remover as CHECK (`migrate diff` vazio).
- **E-mail e nome de departamento em `citext`**: unicidade e busca sem diferenciar maiúsculas no próprio banco; as varreduras manuais de "todos os usuários" para comparar e-mail saíram do código.
- **Exclusões e índices** (item 7): cascata onde o filho não existe sozinho (achado → varredura, evento → campanha); restrição onde há histórico (varredura → ativo, evento → usuário, usuário → departamento). Índices nas chaves estrangeiras e no `AuditLog` (usuário e data).
- **Remediação em JSONB** (`Json` do Prisma).
- **Achado real do pentest no Postgres**: o caractere NUL (`\u0000`) no e-mail do login virava erro 500 (o Postgres recusa NUL em texto; o SQLite aceitava). Agora é barrado na borda com `400 CARACTERE_INVALIDO`, no corpo, na query e no caminho.
- **Testes** em um banco Postgres por arquivo (`baluarte_test_<arquivo>`), recriado pelas migrations — as migrations são testadas a cada execução. O helper recusa servidor não local, para nunca apagar o Supabase por engano. 174 no backend (eram 166): 7 novos de garantias do banco e 1 de NUL. Newman 70/70, Robot 29/29 e Playwright em modo real 10/10 contra a stack Docker com Postgres.
- **O SQLite antigo do Docker** foi copiado para `backend/prisma/backup-docker-sqlite-2026-10-07.db` (fora do git) antes de limpar o volume.
- **Pendente:** apontar para o Supabase exige criar/escolher o projeto e colocar a senha no `backend/.env` (passo a passo no README).

## 2026-10-07 — Classificação e remediação dos achados; departamentos

Itens 1, 2 e 4 da revisão do banco.

- **Remediação no `Finding`** — antes não existia no banco, e com o backend real a aba "Remediação" do detalhe saía sempre vazia (o adaptador montava `remediation: []`; só a demo com mocks mostrava passos). Agora cada achado guarda os passos de correção (título, descrição, esforço), copiados do catálogo no momento do achado, e a API os devolve numerados. Guardado como JSON numa coluna de texto, e não "um passo por linha" como planejado: a tela já espera título, descrição e esforço separados, e o texto por linha perderia isso.
- **CWE, CVE e vetor CVSS** — campos opcionais `cwe`, `cve` (só em achado de componente) e `cvssVetor`. **A nota sai do vetor** (calculadora CVSS 3.1 em `src/cvss.ts`, conferida contra notas conhecidas) e a severidade sai da nota, então os três nunca se contradizem. O frontend deixou de "achar" o CVE no texto da descrição por expressão regular.
- **Catálogo do scanner** (`src/catalogo.ts`) — 10 tipos de falha com categoria OWASP, CWE, vetor e remediação; a varredura simulada e o `seed:demo` usam o mesmo catálogo. As notas da demonstração mudaram porque agora são calculadas do vetor (ex.: o lodash do `seed:demo` passou de 4.2 para 9.1, a nota real do CVE-2019-10744).
- **Departamentos** — tabela `Department` (campos em inglês, por decisão do projeto) e `User.departmentId`. Seed com Comercial, Diretoria, Financeiro, Operações, RH e TI; o `seed:demo` distribui os colaboradores entre eles.
  - API (em português, como o resto): `GET /departamentos` (Administrador/Analista), `POST /departamentos` e `DELETE /departamentos/:id` (Administrador). Departamento com usuários não é excluído (`409 DEPARTAMENTO_EM_USO`).
  - `POST /users` e `PATCH /users/:id` aceitam `departamento` pelo nome (opcional; `null` tira o departamento; nome desconhecido dá `400 DEPARTAMENTO_INVALIDO`). `GET /usuarios` e `GET /me` devolvem o departamento.
  - O relatório da campanha traz `porDepartamento` e o departamento de cada treinamento. O agrupamento usa o departamento **atual** da pessoa (sem cópia histórica, limitação aceita).
  - Frontend: o campo de departamento do cadastro de usuário lista a tabela (antes era uma lista fixa no código), e o valor fixo "Colaboradores internos" saiu do adaptador.
- **Testes** — 166 no backend (eram 152): calculadora CVSS, validação de CWE/CVE/vetor, catálogo, achados da varredura, CRUD e RBAC de departamentos, usuário com departamento, relatório por departamento. Frontend 323/323 e lint limpo. Newman 70/70. Conferido no navegador com o backend real: detalhe com CVE, CWE, vetor e passos; cadastro de usuário com departamento; campanha e treinamentos agrupados por departamento.
- **Atualizar banco existente** — mesma orientação da entrada anterior (`db:reset` + `seed` + `seed:demo`; no Docker, `docker compose down -v`).

## 2026-10-07 — Campanha ligada ao usuário e token do treinamento com hash

Primeira etapa da revisão do banco (itens 3 e 5 da análise do esquema). Mudança só de backend e banco; o frontend não precisou mudar.

- **`CampaignEvent` ligado a `User`** — o evento de campanha deixa de apontar para o destinatário só por um e-mail em texto: `userId` obrigatório (chave estrangeira), com o e-mail mantido como cópia do momento do envio. O `CampaignEvent` já era a tabela de ligação campanha ↔ usuário, então não foi criada outra.
  - `POST /campaigns` só aceita destinatário **cadastrado e não inativo** (`422 DESTINATARIO_NAO_CADASTRADO`). A checagem vem depois das de formato (`400`), domínio (`422 DESTINATARIO_EXTERNO`) e template, para o contrato do Newman responder exatamente como antes.
  - **Unicidade** (`campaignId`, `userId`) no próprio banco: a mesma pessoa não entra duas vezes na mesma campanha, mesmo que um caminho futuro esqueça de deduplicar.
  - **Usuário com histórico de campanha não é excluído** (`409 USUARIO_COM_HISTORICO`, `onDelete: Restrict`): apagar distorceria as métricas históricas; a saída é inativar.
  - O dono do treinamento passa a ser decidido pelo `userId`, não pela comparação de e-mails.
- **Token do treinamento separado do id do evento** — o `GET /treinamentos/:token` era público e o "token" era o id do evento, que o próprio relatório da campanha distribui. Agora são dois acessos:
  - **Dentro do sistema:** `GET /treinamentos/:token` continua usando o id do evento (os links do frontend não mudam), mas **exige login**; Colaborador só o próprio.
  - **Link do e-mail:** `GET /treinamentos/link/:token` (público; registra abertura e clique uma vez, entrega o treinamento sem expor ids nem a campanha) e `POST /treinamentos/link/:token/concluir`. Token aleatório de 256 bits por destinatário, gerado ao criar a campanha; no banco fica só o hash SHA-256, como no reset de senha (helpers em `src/tokens.ts`, compartilhados pelos dois fluxos). Sem serviço de e-mail, o link vai para o log com `TREINAMENTO_LINK_CONSOLE=1`, nunca em produção.
- **Seeds** — `colaborador@empresa.com` / `Colab@123` passa a existir no seed de contrato (antes só nos mocks do frontend), porque é o destinatário das campanhas do Newman e do Robot. O `seed:demo` cria os 203 colaboradores-alvo das campanhas de demonstração.
- **Testes** — 152 no backend (eram 144): campanha com não cadastrado/inativo, vínculo e hash por evento, unicidade, exclusão com histórico, link público (token desconhecido, id do evento no lugar do token, concluir antes de abrir, clique registrado uma vez, conclusão idempotente) e leitura protegida do treinamento. Newman: 35 requisições / 70 asserções, 0 falhas.
- **Atenção ao atualizar um banco existente** — `userId` obrigatório não pode ser adicionado a eventos que já existem, então o `db push` pede reset. Local: `npm run db:reset && npm run seed && npm run seed:demo`. Docker: `docker compose down -v` antes de subir (o volume é recriado e semeado).

## 2026-10-07 — Cadastro por convite, e-mail de conta e sessão no servidor

- **Fim da senha provisória fixa** — todo usuário criado pelo administrador nascia com `Mudar@123`, publicada no repositório, e a conta `Pendente` já entrava com ela: quem lesse o código podia tomar qualquer conta recém-criada. Agora `POST /users` cria a conta `Pendente` com um hash descartável (nenhuma senha confere) e envia um **convite por e-mail**, com link de 72 h e uso único, para a pessoa criar a própria senha. Conta `Pendente` não entra por login (`403 CONTA_PENDENTE` para as antigas que ainda tinham a senha fixa). `POST /users/:id/convite` reenvia; "esqueci a senha" de uma conta pendente manda um convite novo.
- **E-mail de verdade** — `src/email.ts` (nodemailer): SMTP para o **Mailpit** do Compose (`:8025`, nada sai da máquina), caixa em memória nos testes, log em dev sem SMTP. O link de redefinição deixou de ser impresso no log (`RESET_TOKEN_CONSOLE` saiu).
- **Sessão no servidor** — `POST /auth/logout` invalida os tokens emitidos antes (todos os dispositivos); `POST /auth/renovar` mantém a sessão viva enquanto há uso (expira com 30 min parada, teto de 8 h); trocar a senha encerra as outras sessões e devolve um token novo. `POST /auth/link/verificar` deixa a tela conferir o link antes de pedir a senha.
- **Limites no banco** — falhas de login (`LoginFailure`) e pedidos de redefinição (`ResetRequest`) saem da memória: o bloqueio vale depois de reiniciar a API e entre instâncias. Redefinir a senha pelo link tira a conta do bloqueio.
- **Auditoria** — `LOGIN`, `LOGIN_BLOQUEADO`, `LOGOUT`, `CRIAR_USUARIO`, `ENVIAR_CONVITE`, `ACEITAR_CONVITE`.
- **Banco** — migrations `conta_convite_login` (`PasswordResetToken.tipo` com CHECK `RESET`/`CONVITE`, `User.sessaoEncerradaEm`, `LoginFailure` com RLS) e `limite_reset_no_banco` (`ResetRequest` com RLS).
- **Testes** — 192 no backend (eram 174): `tests/conta.test.ts` novo (convite, reenvio e RBAC, verificação do link, logout, renovação, troca de senha, bloqueio persistido, auditoria); os testes passam a criar contas pelo convite, lido da caixa de e-mail em memória.
- **Problema conhecido** — a migration `habilita_rls` faz `ALTER TABLE "_prisma_migrations"`, tabela que não existe no banco-sombra do `prisma migrate dev`: o comando falha para qualquer migration nova. Como ela já está aplicada no Postgres local e no Supabase, o arquivo não foi alterado; migrations novas são geradas com `migrate dev --create-only` apontando para um banco descartável recém-criado, até a correção ser decidida.

## 2026-10-07 — Cabeçalhos de segurança e dependências sem alerta (B11)

- **`helmet` 8.3** na API, antes de tudo (os cabeçalhos saem também nos erros 400/401/404 e no preflight do CORS): CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS (só vale em HTTPS). CORS e `x-powered-by` desligado sem mudança.
- **Dependências** — `npm audit fix` sem `--force` no backend: `proxy-addr` 2.0.8 (alerta crítico), `body-parser` 1.20.8 e `qs` 6.16.0 (moderados), `express` 4.22.3. `npm audit` zerado. No frontend ficou o alerta moderado do `react-router` 6, que só sai com a versão 7 (major; um dos alertas é de SSR, que a SPA não usa).
- **Fora:** limite de requisições por IP — em memória não funciona na API serverless da Vercel.
- **B02** (commit anterior) — `GET /scans` só para Administrador/Analista; a política de segurança deixa de afirmar log imutável e retenção de 12 meses.
- **Testes** — 200 no backend (7 banco + 80 integração + 113 pentest).

## Resumo por área (estado atual)

| Área | O que existe | Desde |
|---|---|---|
| Contrato N2 AT1 (6 rotas + `frontend/` legado) | Completo, intocado desde `e414d94` | 2026-06-18 |
| Backend real (Express+Prisma+PostgreSQL com migrations e CHECK, RBAC server-side, AuditLog) | Completo para o escopo atual (scanner e phishing simulados) | 2026-10-07 |
| Frontend do produto (`baluarte-frontend/`) | Completo, com identidade visual própria, RBAC por tela e todos os indicadores do dashboard navegáveis | 2026-09-18 |
| Testes | 200 no backend (7 banco + 80 integração + 113 pentest) · 323 no frontend (Vitest+RTL+axe) + Playwright · Newman 70 + Robot 29 (N2 AT1) | 2026-10-07 |
| Deploy | Docker Compose local (4 serviços, com Postgres) + demo pública na Vercel (frontend/mock), com deploy automático a cada push na `main` | 2026-09-18 |
| Lint / formatação | `npm run lint` limpo em qualquer sistema (LF forçado no `.gitattributes`) | 2026-09-18 |
| Plano de evolução (Postgres, RS256, e-mail, scanner real, campanhas reais, hardening) | Documentado, não iniciado | `backend/PLANO.md` |
