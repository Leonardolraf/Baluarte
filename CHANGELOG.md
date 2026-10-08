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

## 2026-10-07 — Varredura com status que anda (B21)

A varredura continua **simulada**, mas deixa de ficar "na fila" para sempre.

- **Status pelo tempo decorrido** — `EM_FILA` nos primeiros 5 s, `EM_ANDAMENTO` até 20 s, `CONCLUIDA` depois (`backend/src/varredura.ts`). Não há timer depois da resposta: a API também roda como função serverless na Vercel, que congela ao responder. A transição é calculada e **gravada na leitura** (`GET /scans`, `/dashboard`, `/vulnerabilidades` e antes de criar uma varredura), com `concluidoEm` = criação + 20 s.
- **Achados só na conclusão** — antes eram gravados no `POST /scans`, junto com a varredura em fila. Agora nascem quando a varredura conclui, dentro de uma transação que só uma leitura concorrente vence (sem achado duplicado); varredura antiga que já tinha achados conclui sem ganhar outros. Assim nenhuma lista nem indicador precisa filtrar "achado de varredura não concluída".
- **Uma varredura por vez no ativo (RN-003)** — `POST /scans` recusa com `409 VARREDURA_EM_ANDAMENTO` enquanto a anterior não conclui; a linha do ativo é travada na criação (`SELECT … FOR UPDATE`), então pedidos simultâneos criam uma só. As validações do contrato (400/404/422) vêm antes. A collection do Newman e as suítes Robot foram conferidas: o Newman cria uma única varredura com sucesso (`ativo-001`) por execução e o Robot não cria nenhuma, então o contrato segue igual (`dados.statusVarredura === 'EM_FILA'`). Rodar o Newman duas vezes em menos de 20 s no mesmo banco daria 409 no CT-S1 — o README já exige banco limpo a cada execução.
- **Frontend** — tela nova **Varreduras** (`/scans`, Administrador/Analista, na barra lateral): inicia a varredura de um ativo ativo (o que já está em curso aparece desabilitado), mostra status, duração e achados (só na conclusão, com link para as vulnerabilidades do host) e consulta de novo a cada 3 s, sem piscar a tela, enquanto houver varredura em curso. A camada mock espelha o ciclo, os achados na conclusão e o 409.
- **Sem mudança de schema** — o `CHECK` já aceitava os três status.
- **Testes** — 205 no backend (eram 194): `tests/varredura.test.ts` (transições com `criadoEm` recuado no banco, sem dormir; concluir direto da fila; leituras simultâneas; bloqueio, simultaneidade e ordem das validações). 329 no frontend (eram 324): ciclo e 409 na camada mock, tela com consulta automática, auditoria axe de `/scans`.

## 2026-10-07 — E-mail simulado da campanha e "reportar e-mail suspeito" (B19)

- **E-mail de verdade para cada destinatário** — `POST /campaigns` passa a enviar, pelo mesmo `src/email.ts` dos e-mails de conta (Mailpit em dev/demo, caixa em memória nos testes, nada em produção sem SMTP), o e-mail do template (`src/campanhaEmail.ts`): urgência ("conta bloqueada em 24 horas"), autoridade ("pedido da Diretoria") e curiosidade ("plano de cargos e salários"), como o frontend descreve cada um. Só texto, sem anexo, sem pedido de senha, remetente da plataforma (`EMAIL_REMETENTE`) e rodapé que identifica a **simulação de treinamento interno**. Os dois links vão para o próprio frontend: `/t/<token>` (treinamento; o clique já era registrado por `GET /treinamentos/link/:token`) e `/t/<token>/reportar`. `enviadoEm` passa a ser marcado só para quem recebeu (antes ficava vazio e o funil mostrava 0 enviados). O `TREINAMENTO_LINK_CONSOLE` saiu.
- **Contrato** — mesmos status, mensagens e códigos de erro; a resposta ganha `emailsEnviados`. Campanha recusada (formato, domínio, template, destinatário não cadastrado/inativo) não envia nada. Falha de envio não desfaz a campanha.
- **Reportar** — `POST /treinamentos/link/:token/reportar` (público, mesmo token do link): grava `reportouEm` (campo que já existia no `CampaignEvent`, sem migration) e a abertura, não conta clique, é idempotente (o primeiro reporte vale; `updateMany` condicional evita registro duplo concorrente) e responde `404 LINK_NAO_ENCONTRADO` para token inválido. O `GET` não registra nada: a tela pede confirmação, para antivírus que pré-visitam links não "reportarem" por ninguém.
- **Relatório** — `GET /campanhas/:id` traz `reportes[]` (destinatário, departamento, data, se clicou) e `reportouEm` em cada treinamento; o detalhe da campanha no frontend mostra quem reportou (inclusive quem não clicou) e os reportes na linha do tempo.
- **Auditoria** — `CRIAR_CAMPANHA`, `ENVIAR_CAMPANHA` (quantos de quantos) e `REPORTAR_PHISHING`.
- **Frontend** — o link do e-mail não tinha tela: rotas públicas novas `/t/:token` (a mesma `TrainingPage`, em modo link, sem login e sem expor a campanha) e `/t/:token/reportar` (`ReportPhishingPage`, com confirmação). Métodos `getTrainingByLink`, `completeTrainingByLink` e `reportPhishing` na API real e nos mocks (no mock, o token é o id do destinatário). Textos do formulário de campanha e do "Sobre" deixaram de dizer que nenhum e-mail é enviado.
- **Fora do escopo** — pixel de abertura (o e-mail é só texto; a abertura vem do clique ou do reporte).
- **Testes** — 221 no backend com o B21 (204 só com este item) (`tests/campanha-email.test.ts`, 10 novos: e-mail por destinatário com o link e o token certos, texto por template sem link externo, nada enviado em campanha recusada, auditoria, produção sem SMTP sem envio nem log do link, clique pelo token do e-mail, reporte idempotente, relatório com reportes, token inválido); 335 no frontend (adaptador, mocks, as duas telas novas e a auditoria axe delas).

## 2026-10-08 — Senha repetida na redefinição e link de redefinição pelo administrador

Pedidos do Leo depois de testar o convite em produção.

- **Redefinição recusa a senha atual** — `POST /auth/reset-password/confirm` passa a responder `400 SENHA_REPETIDA` (mesma mensagem da troca de senha logada) quando a nova senha é igual à atual; o link não é consumido. O convite não é afetado: a conta pendente tem hash descartável, então a primeira senha sempre passa.
- **Administrador envia o link de redefinição** — `POST /users/:id/redefinir-senha` (só Administrador; conta ativa; `409 USUARIO_NAO_ATIVO` para Pendente/Inativa, `404`, `502 EMAIL_NAO_ENVIADO`). Rota própria em vez da pública para auditar quem pediu (`ENVIAR_RESET_SENHA`) e não gastar o limite de 3 pedidos por e-mail do dono da conta.
- **Frontend** — a tela de editar usuário ganha uma ação que acompanha o status da conta: **Pendente** reenvia o convite, **Ativa** dispara o link de redefinição, **Inativa** não mostra nada (mandar link para quem está sem acesso não faz sentido). O `SENHA_REPETIDA` passa a aparecer no campo "Nova senha" da tela de redefinição, como já acontecia na troca de senha logada.
- **Testes** — 227 no backend (7 banco + 107 integração + 113 pentest); 340 no frontend.

## 2026-10-07/08 — A demo pública passa a rodar com banco real

Até aqui a demo da Vercel era só o frontend com dados em memória. Agora é a aplicação inteira: navegador → frontend → **API serverless** → PostgreSQL no **Supabase**.

- **API publicada** — o app Express já era exportado separado do `listen`, então a função é um wrapper fino (`backend/api/index.ts` + `backend/vercel.json`, projeto `baluarte-api`). `binaryTargets` inclui o runtime Linux da Vercel e `vercel-build` roda `prisma generate`. A API usa o **transaction pooler** do Supabase (`pgbouncer=true&connection_limit=1`), padrão exigido em serverless; as migrations usam o session pooler.
- **Frontend ligado à API** — `VITE_USE_MOCKS=false` e `VITE_API_BASE_URL`. Vale lembrar que essas variáveis entram no bundle em tempo de build: sem elas em Production, um rebuild silenciosamente volta a demo para os mocks.
- **E-mail em produção** — SMTP do Gmail com senha de aplicativo. Convite e redefinição chegam de verdade; o remetente precisa ser a mesma conta autenticada. Só vale para endereços reais: `@empresa.com` é domínio fictício e os e-mails do seed não chegam a lugar nenhum.
- **Senha inicial padrão, introduzida e revertida no mesmo dia** — para demonstrar criação de conta sem servidor de e-mail, `POST /users` passou a criar a conta `Ativa` com uma senha fixa (`28d077e`). Com o SMTP funcionando, a decisão foi desfeita (`ec39e14`) e o convite voltou a ser o único caminho. Durante essa janela, três contas nasceram com a senha pública: duas eram de teste e foram removidas; a terceira teve a senha trocada pelo dono. Fica registrado porque o valor esteve no repositório.
- **Dois erros de configuração que custaram deploys** — os projetos da Vercel foram criados pelo CLI de dentro da subpasta, então o **Root Directory** nasceu apontando para a raiz do monorepo nos dois. Deploy por CLI funcionava (subia a pasta certa) e **todo deploy por Git falhava**, no frontend com build da pasta errada e na API com erro em 2–4 s. Sem a correção, o merge na `main` não teria publicado nada e a Vercel manteria no ar a versão anterior, sem sinal de erro.
- **Lista de ativos deixa de mentir** — a tela mostrava "0 achados" e "nunca varrido" em todos os ativos, contra 6 achados no dashboard: o adaptador fixava `openFindings: 0` e `lastScanAt: null`, o que só apareceu quando a tela de listagem passou a existir. Os dois valores passam a ser derivados das listas que a própria tela lê (achados agrupados por **host**, porque a API identifica o ativo do achado pelo host, não por id).
- **Operação** — projeto gratuito do Supabase **pausa após 7 dias sem uso**: restaurar no painel antes de apresentar. Valores marcados como *Secret* na Vercel não podem ser lidos de volta pelo CLI, então migration e seed contra o Supabase exigem a connection string à mão.

## 2026-10-08 — Treinamentos numa requisição só e ativos com contagem pronta

A tela de treinamentos levava ~9 s em produção: uma requisição por campanha, somadas no cliente (cada ida ao banco pelo pooler serverless custa caro).

- **`GET /treinamentos/consolidado`** (Administrador/Analista) — campanhas, cliques, conclusões, pendentes após clique, conclusões nominais, colaboradores que concluíram (com as campanhas de cada um) e conclusões por departamento, já ordenados. Conclusão = clicou e concluiu, a mesma regra do relatório da campanha, então o total bate com o KPI do dashboard (há teste comparando com a soma dos relatórios).
- **`GET /assets`** ganha `achadosAbertos` (mesma regra de "aberto" dos KPIs) e `ultimaVarredura`, para o frontend não cruzar as listas de vulnerabilidades e varreduras por host.
- **Testes** — 232 no backend (7 banco + 112 integração + 113 pentest).

## 2026-10-08 — Testes de unidade e cobertura medida (B03)

Item 3.2 do roteiro do professor: teste de unidade com percentual de cobertura e taxa de sucesso.

- **47 testes de unidade** em `backend/tests/unidade/`, sem banco, sem servidor e sem rede (< 1 s): cálculo CVSS 3.1 contra valores da calculadora do FIRST, CWE/CVE, catálogo e remediação, ciclo da varredura simulada, validações de entrada, política de senha, tokens de link, JWT e middlewares de autenticação/RBAC, envelope de erro, transportes de e-mail e o texto do e-mail simulado da campanha.
- **Defeito achado pelos testes de unidade:** `hostValido('10.0.0')` aceitava o valor (sem ser IPv4, caía na regra de nome de domínio). Nome de domínio nunca termina em rótulo numérico; corrigido.
- **Cobertura com c8** — `npm run cobertura:unidade`, `npm run cobertura` e `npm run test:relatorio`, que escreve `coverage/RELATORIO.md` com taxa de sucesso e % de linhas, ramos e funções. Metas mínimas no c8 e no Vitest do frontend (o comando falha abaixo delas).
- **Números:** backend unidade 47/47 (80,5% linhas, 93,0% ramos); backend completo 279/279 (98,7% linhas, 94,2% ramos, 98,8% funções); frontend 340/340 (84,1% linhas, 79,9% ramos, 63,2% funções).

## 2026-10-08 — Latência da demo: função junto do banco e uma requisição por tela

A demo pública estava lenta no navegador e pior no celular. Medido antes de mexer: o peso não era o JavaScript (118 KB gzip no primeiro carregamento, maior resposta da API com 41 KB) — era **ida e volta até o banco**. A função serverless rodava em `iad1` (Virginia) e o PostgreSQL do Supabase está em `us-west-2` (Oregon), então cada consulta atravessava os Estados Unidos, e as telas faziam várias consultas em sequência.

- **Função na mesma região do banco** — região das funções da API mudada de `iad1` para `pdx1` (Oregon). Medido em produção, 5 amostras por rota: dashboard 2,61 s → 0,44 s; usuários 1,35 s → 0,42 s; vulnerabilidades 1,78 s → 0,40 s (**3 a 6×**; o pico de 13× que apareceu em preview não se sustentou em produção). Confirmado pelo `X-Vercel-Id` (`gru1::pdx1::…`). **Esse ajuste é configuração do projeto na Vercel, não está no repositório** — se o projeto for recriado, precisa ser refeito.
- **Uma requisição por tela** ([`de254c5`](https://github.com/Leonardolraf/Baluarte/commit/de254c5)) — a tela de treinamentos consumia os agregados de `GET /treinamentos/consolidado` em vez de pedir o relatório de cada campanha e somar no cliente (1+N → 1 requisição: ~9 s → ~1,5 s); a de ativos passou de 3 requisições para 1, usando `achadosAbertos` e `ultimaVarredura` que a API já entrega (~1,2 s). O dashboard deixou de pedir `/scans` para o perfil Colaborador, que não usa esse dado.
- **Ajustes de interface no mesmo lote** ([`664a457`](https://github.com/Leonardolraf/Baluarte/commit/664a457)) — a placa de indicadores do dashboard segue o tema claro/escuro (antes era sempre escura), o cabeçalho saúda o usuário logado pelo nome e "Cadastrar ativo" saiu da tela de vulnerabilidades, onde não pertencia.

## 2026-10-08 — Backend separado em módulos por domínio (B01)

Fase 0 do `backend/PLANO.md`: a regra de negócio saiu dos três arquivos de rota (`routes/api.ts`, `read.ts`, `manage.ts`) para módulos de domínio, sem mudar nenhuma rota, mensagem ou código de erro.

- **Estrutura** — `src/app.ts` (o app Express) e `src/http` (servidor, roteador, middlewares de token e perfil, envelope de resposta), `src/platform` (Prisma, e-mail, tokens de link), `src/shared` (validações de entrada e constantes) e `src/modules/<domínio>/{routes,service,repository}.ts` para auth, users, departments, assets, scanner, reports (vulnerabilidades), campaigns, training, dashboard, notifications e audit.
- **Padrão** — a rota valida o formato e responde; o serviço tem a regra e lança `falhar(status, mensagem, código)`; o `wrap` converte esse erro de negócio no mesmo envelope do contrato; o repositório fala com o Prisma.
- **Testes** — 289 no backend (eram 279): 10 testes de unidade novos para as peças criadas (erro de negócio no `wrap`, métricas de campanha, conteúdo e permissão do treinamento, constantes). Unidade 57/57 (83,9% de linhas); completa 289/289 (98,8% de linhas, 95,3% de ramos). Contra a API refatorada: Newman 35 requisições / 70 asserções e Robot 29/29, sem falhas.

## 2026-10-08 — Validação de entrada com zod (B09)

Último item da Fase 0 do `backend/PLANO.md`.

- **`shared/esquemas.ts`** — schemas zod dos campos (presença, texto, e-mail, host, senha da política, listas fixas, nota CVSS, parâmetro de query) e `validar(corpo, regras)`, que aplica as regras **na ordem do contrato** e lança o erro de negócio da primeira que falha. A ordem faz parte do contrato da N2 AT1 (no login: e-mail vazio → senha vazia → formato do e-mail), por isso as regras são uma lista e não um `z.object`, que juntaria os erros por campo.
- **Rotas de todos os módulos** declaram as regras de entrada em vez de `if`s espalhados; só as checagens que cruzam campos ou percorrem listas ficaram no código da rota. Os predicados de `shared/validacao.ts` passam a usar os mesmos schemas (uma fonte de verdade por formato).
- **Testes** — 299 no backend (10 de unidade novos para os schemas e a ordem das regras). Newman 35 requisições / 70 asserções e Robot 29/29 contra a API com zod, sem falhas.

## 2026-10-08 — E-mail pela API do Brevo

Preparação para publicar a API no Railway (plano Hobby), que bloqueia as portas de SMTP (25/465/587), assim como o Render gratuito.

- **Transporte Brevo** em `src/platform/email.ts`: com `BREVO_API_KEY`, o e-mail sai pela API HTTPS do Brevo (`/v3/smtp/email`), com o remetente de `EMAIL_REMETENTE` (verificado na conta) e só texto. Tem prioridade sobre o SMTP; o Mailpit (dev) e o Gmail (Vercel) continuam funcionando sem mudança.
- Falha do Brevo vira `false` como nos outros transportes; o log leva só o status e o código do erro, nunca a chave nem o conteúdo do e-mail.
- **Testes** — 4 de unidade novos, contra um servidor HTTP local no lugar do Brevo (nenhum e-mail real sai): carga enviada, prioridade sobre o SMTP, erro sem vazar chave nem link, leitura do remetente.

## 2026-10-08 — Cobertura de funções do frontend (DT03)

As funções do frontend estavam em 63,2%, abaixo dos 70% do RNF-08.

- **Testes novos (59)** — `realApi.test.ts` (35): a implementação real da API (axios) contra um adapter falso no `httpClient`, sem rede: JWT no cabeçalho, erros normalizados e eventos 401/403, tempo esgotado e falha de rede, caminhos, corpos em português e conversão dos envelopes de todas as rotas. `tables.test.tsx` (12): ordenação, filtros, estado vazio, esqueleto, paginação e clique nas tabelas de vulnerabilidades e campanhas. `AssetFormPage.test.tsx` (5): validação do cadastro de ativo, envio e erro da API no campo certo ou no banner. `uiStore.test.tsx` (7): tema, barra lateral, indicador de operações e toasts.
- **Números** — frontend 399/399 (eram 340): linhas 84,1% → 90,0%, ramos 79,9% → 82,2%, funções 63,2% → 81,8%. A meta mínima de funções no `vitest.config.ts` sobe de 60% para 70%.

## 2026-10-08 — Backend em camadas: rotas, controllers, services, models e repositories

Pedido do professor: o backend passa de módulos por domínio (`src/modules/<domínio>/{routes,service,repository}.ts`) para uma **arquitetura em camadas**, com uma pasta por camada e, dentro dela, um arquivo por funcionalidade (nomes em português, no singular). Nenhuma rota, mensagem, código de erro, status, ordem de validação ou formato de resposta mudou.

- **`routes/`** — `index.ts` (o roteador `/api`, na mesma ordem de registro) e `<f>.routes.ts`, que só declaram caminho + `exigeToken`/`exigePerfil` + `wrap(controller.funcao)`.
- **`controllers/`** — uma função por endpoint: lê a requisição, valida a entrada com as regras do model, chama o service e monta a resposta. As checagens que ficavam no código da rota (domínio interno dos destinatários da campanha, `AUTO_INATIVACAO`, "nenhuma preferência informada") estão aqui.
- **`services/`** — regra de negócio, chamando o repository direto. Os auxiliares viraram services com nome próprio: `token` (JWT), `linkConta`, `cvss`, `cicloVarredura`, `campanhaEmail`, `campanhaMetricas`, `auditoria`. As consultas ao Prisma que ainda estavam em services (links de conta, ciclo da varredura, marcação de envio da campanha, transações de usuário) e no middleware de token desceram para os repositories.
- **`models/`** — como o banco é do Prisma, o model não é ORM: tipos do domínio derivados do `@prisma/client`, DTOs, as listas de regras zod de entrada e os dados estáticos (`dominio.model.ts`, `catalogoAchado.model.ts`, `treinamento.model.ts`).
- **`repositories/`** — único acesso ao Prisma. **`middlewares/`**, **`config/`** (Prisma, e-mail) e **`utils/`** (envelope de resposta, schemas zod, validação, tokens de link) completam a árvore; `app.ts` fica em `src/` por causa do preset Express da Vercel e o servidor vai para `src/server.ts`.
- **Testes** — backend 303/303 contra PostgreSQL, cobertura de unidade dentro das metas (linhas 87,6%, ramos 93,7%, funções 76,7%), Newman 35 requisições / 70 asserções sem falhas, `tsc --noEmit` limpo.

## 2026-10-08 — Análise de arquivos com ClamAV (B04)

Primeiro método novo de varredura: qualquer perfil envia um arquivo e o sistema diz se há ameaça conhecida.

- **`POST /arquivos/analise`** (multipart, campo `arquivo`, até 10 MB) e **`GET /arquivos/analises`** (histórico; Colaborador vê só o próprio, operadores veem todos com quem enviou). Erros: `400 ARQUIVO_OBRIGATORIO`, `413 ARQUIVO_MUITO_GRANDE`, `429 MUITAS_ANALISES` (20 por hora por usuário), `503 ANTIVIRUS_INDISPONIVEL`.
- **Sem disco** — o `busboy` lê o multipart em fluxo e cada bloco vai direto ao clamd (protocolo INSTREAM, `config/antivirus.ts`), com SHA-256 e tamanho calculados no caminho. O arquivo nunca é gravado nem devolvido; fica só o registro (nome para exibir, sem caminho; tamanho; SHA-256; veredito). O texto nunca afirma "arquivo seguro".
- **ClamAV 1.5 no Compose** como perfil opcional (`--profile antivirus`): a documentação pede 3 a 4 GiB de RAM. Assinaturas atualizadas pelo freshclam e guardadas em volume.
- **Tabela `FileScan`** com migration, CHECKs (veredito, SHA-256 em hexadecimal, ameaça só com AMEACA) e RLS; auditoria `ANALISAR_ARQUIVO`.
- **Verificado com o ClamAV real**: o arquivo de teste EICAR, enviado da memória, voltou "Ameaça encontrada: Eicar-Test-Signature" com o SHA-256 oficial do EICAR; arquivo comum voltou "Nenhuma ameaça conhecida encontrada".
- **Testes** — 321 no backend: 7 de unidade do cliente do clamd e 11 de integração (contra um clamd falso em TCP). Newman 35 requisições / 70 asserções sem falhas.
- **Produção** — sem ClamAV a rota responde 503. Decisão pendente do Leo: plano maior no Railway, demonstrar só localmente, ou VirusTotal pelo hash (B20) em produção.

## Resumo por área (estado atual)

| Área | O que existe | Desde |
|---|---|---|
| Contrato N2 AT1 (6 rotas + `frontend/` legado) | Completo, intocado desde `e414d94` | 2026-06-18 |
| Backend real (Express+Prisma+PostgreSQL com migrations e CHECK, RBAC server-side, AuditLog) | Completo para o escopo atual (scanner e phishing simulados) | 2026-10-07 |
| Frontend do produto (`baluarte-frontend/`) | Completo, com identidade visual própria, RBAC por tela e todos os indicadores do dashboard navegáveis | 2026-09-18 |
| Testes | 321 no backend (78 unidade + 7 banco + 123 integração + 113 pentest; 98,8% de linhas cobertas) · 399 no frontend (Vitest+RTL+axe; 81,8% das funções cobertas) + Playwright · Newman 70 + Robot 29 (N2 AT1) | 2026-10-08 |
| Deploy | Docker Compose local (4 serviços, com Postgres) + demo pública na Vercel **com banco real**: frontend, API serverless e PostgreSQL no Supabase, com e-mail saindo por SMTP. API na mesma região do banco (`pdx1`). Deploy automático a cada push na `main` | 2026-10-08 |
| Lint / formatação | `npm run lint` limpo em qualquer sistema (LF forçado no `.gitattributes`) | 2026-09-18 |
| Plano de evolução | Postgres, e-mail e hardening **feitos**; backend em camadas desde 2026-10-08; faltam RS256 e execução real de varredura/phishing | `backend/PLANO.md` |
