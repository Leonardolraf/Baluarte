# Baluarte V2

Plataforma web de **segurança ofensiva e conscientização** (TCC de Engenharia de Software — UCB), construída como sistema **real** para a disciplina de **Teste de Software**: backend + frontend de verdade, contra os quais rodam as suítes de teste de API (Postman/Newman) e de UI (Robot Framework + Selenium) da N2 AT1 — não mais contra stubs — e a **suíte funcional oficial do produto** (Playwright, em modo mock e contra a API real).

> ⚠️ **Escopo honesto:** a *plataforma* é real (autenticação JWT, RBAC, persistência, dashboard com agregações reais, trilha de auditoria). O **scanner OWASP** e o **disparo de phishing** são **simulados no servidor** (criar varredura gera achados realistas) — nenhum ataque real é executado. A campanha de phishing envia de verdade um **e-mail simulado** a cada destinatário interno cadastrado, identificado no rodapé como simulação da plataforma, sem anexo, sem pedido de senha e só com links para o próprio frontend (treinamento e "reportar"). Esse e-mail e os de conta (convite e redefinição de senha) vão para o Mailpit do Docker Compose (`http://localhost:8025`), que não entrega nada para fora.

## Arquitetura

| Camada | Pasta | Stack | Porta |
|---|---|---|---|
| **API** | `backend/` | Node + Express + TypeScript + Prisma · JWT (HS256) + bcrypt · RBAC · AuditLog | `8080` |
| **Banco** | `docker-compose.yml` (`db`) | PostgreSQL 16 · migrations Prisma · restrições CHECK · `citext` | `5432` (só local) |
| **Frontend (produto)** | `baluarte-frontend/` | React 18 + Vite + TypeScript + TailwindCSS · RBAC por rota · tema claro/escuro · camada mock ou backend real | `5173` (dev) · `8081` (Docker) · `8443` (Docker, HTTPS) |
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
| **API — integração + pentest** (node:test, um banco Postgres isolado por arquivo) | `backend/tests/` | `cd backend && npm test` (precisa do Postgres local no ar) | 582 testes. Unidade (156, em `tests/unidade/`, sem banco nem servidor: cruzamento com vulnerabilidades — ecossistema do OSV, tabela Windows → CPE, leitura das respostas do OSV e do NVD, severidade, clientes HTTP contra servidor falso; nota de risco do ativo (fórmula, teto, ranking com empates), leitura do histórico de status na auditoria, regras de paginação da lista de vulnerabilidades, CVSS 3.1, catálogo, varredura e o progresso dela (percentual, etapa e estimativa nas bordas do ciclo, coerência com o status gravado, id do caminho), validações, política de senha, tokens, JWT/RBAC, erro de negócio, validação zod (ordem das regras do contrato, consulta do histórico de análises), métricas de campanha, treinamento, e-mails, relatório em PDF (resumo, ordem por CVSS, fuso, WinAnsi, quebra de página), domínio interno e normalização do host, cliente do VirusTotal contra um servidor HTTP local). Banco (7): restrições CHECK, `citext`, cascata/restrição. Integração (302): cadeia de hash da auditoria (B29: hash na serialização documentada, gravações concorrentes sem bifurcar, sequência contígua sem salto, adulteração detectada no registro certo, sem a trava o UPDATE aceito e acusado, retenção de 12 meses sem falso positivo, RBAC das rotas novas), cruzamento do inventário com OSV e NVD falsos (achados, cache, não duplicação, dashboard, lista e PDF, nota de risco do ativo-estação, detalhe da estação com achados, falha e tempo esgotado da base, cruzamento automático), lista de vulnerabilidades paginada no banco (páginas sem repetir nem pular com empates, ordem estável, filtros e contagens, busca literal, parâmetros inválidos → 400), PDF com todos os achados do filtro, nota de risco por ativo, 5 ativos de maior risco (ordem, empate, RBAC), histórico do achado (detecção, mudanças da auditoria, aviso de incompleto), estações monitoradas (lista, detalhe com programas e portas, online/offline pela janela, RBAC, id inválido e inexistente), progresso da varredura (`GET /scans` e `GET /scans/:id` com percentual, etapa e estimativa coerentes em cada fase, nada novo gravado no banco, 401/403/400/404, a consulta de uma varredura e o dashboard de qualquer perfil concluem as pendentes, `POST /scans` com a resposta do contrato intacta), relatório de vulnerabilidades em PDF (RBAC, cabeçalhos do download, conteúdo com acentos, filtros iguais aos da lista, filtro inválido → 400, auditoria da exportação), trilha de auditoria (ações novas registradas, consulta com filtros, paginação, RBAC e query inválida → 400), análise de arquivos (antivírus em fluxo, EICAR, limites, histórico por perfil com filtro por resultado e paginação, parâmetro inválido → 400, arquivo malicioso como crítico no dashboard sem contar o mesmo SHA-256 duas vezes e `null` para o Colaborador), segunda opinião do VirusTotal (só o hash, cache, cota no banco, desconhecido, indisponível), treinamentos consolidados, campos agregados de ativos, contrato, e-mail simulado da campanha e reporte de e-mail suspeito, ciclo da varredura simulada e uma varredura por vez no ativo, cadastro por convite, reenvio e verificação do link, logout no servidor, renovação de sessão, bloqueio de login guardado no banco, auditoria do login, RBAC por perfil, conta inativada, limite de login, senha, redefinição, notificações, treinamento (navegação interna e link do e-mail), usuários, "Risco aceito", campanhas (só destinatário cadastrado, domínio interno configurável, unicidade, histórico, resultado por departamento), CVSS 3.1 calculado do vetor, catálogo do scanner (CWE/CVE/remediação), departamentos. Segurança (117, em `tests/seguranca/`): injeção (SQLi/NoSQL/prototype pollution/mass assignment), autorização (token forjado/alg=none/IDOR/escalada, último administrador sem contar o Pendente), força bruta e enumeração, validação de entrada (host com `https://`, IP e descrição do ativo) e exposição de informação (CORS, cabeçalhos, vazamento de segredos, RBAC no payload: dashboard do Colaborador sem KPIs técnicos) |
| **API — Postman/Newman** (N2 AT1) | `testes-api/` | ver abaixo | 35 requisições / 70 asserções, 0 falhas |
| **UI — Robot + Selenium** (N2 AT1) | `e2e/*.robot` | ver abaixo | 29 testes, 0 falhas |
| **Frontend — unitários, componentes, a11y** (Vitest + RTL + axe) | `baluarte-frontend/src/__tests__/` | `cd baluarte-frontend && npm test` | 567 testes |
| **Funcional — Playwright, modo mock** (suíte funcional oficial, desktop + mobile) | `baluarte-frontend/e2e/` | `cd baluarte-frontend && npm run test:e2e` | 39 testes (+14 capturas de tela de referência, só com `E2E_SCREENSHOTS=1`) |
| **Funcional — Playwright, modo real** (suíte funcional oficial contra a API real) | `baluarte-frontend/e2e/real/` | `cd baluarte-frontend && npm run test:e2e:real` (sobe e derruba tudo; ver abaixo) | 19 testes (com ClamAV: 18 + 1 na 2ª rodada; sem ClamAV: 15, e os 4 que dependem dele ficam como *skipped*) |

### Cobertura e relatório de testes (roteiro 3.2)

```bash
cd backend && npm run test:unidade      # só os 156 testes de unidade (sem banco, < 1 s)
cd backend && npm run test:relatorio    # cobertura de unidade + completa e coverage/RELATORIO.md
cd baluarte-frontend && npm run test:coverage
```

O `test:relatorio` mede a cobertura com o c8 e escreve `backend/coverage/RELATORIO.md` com testes, aprovados, falhas, **taxa de sucesso** e **% de linhas, ramos e funções** de cada suíte (relatório por arquivo em `coverage/index.html`). Metas mínimas (o comando falha abaixo delas): unidade 75% linhas / 85% ramos / 70% funções; completa 90% / 85% / 90%; frontend 80% / 75% / 70%.

| Suíte | Testes | Taxa de sucesso | Linhas | Ramos | Funções |
|---|---:|---:|---:|---:|---:|
| Backend — unidade | 120 | 100% | 92,7% | 93,4% | 84,7% |
| Backend — completa (unidade + integração + pentest) | 424 | 100% | 99,2% | 96,0% | 99,2% |
| Frontend (Vitest) | 523 | 100% | 91,8% | 84,7% | 83,9% |

As três medidas das três suítes estão acima dos 70% do RNF-08 (as funções do frontend subiram de 63,2% para 81,8% no DT03).

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

### Funcional — Playwright (suíte funcional oficial do produto, B15)
O Playwright é a **suíte funcional oficial** do frontend do produto (`baluarte-frontend/`). O Robot continua sendo a suíte da N2 AT1, contra o frontend legado (`:3000`); as duas não se misturam. Usa o Chrome instalado na máquina (canal `chrome`), sem baixar navegadores.

| Modo | Comando | Onde | O que cobre |
|---|---|---|---|
| **Mock** | `cd baluarte-frontend && npm run test:e2e` | `e2e/*.spec.ts` | 39 testes na camada mock (dev server na `5173`; `E2E_PORT` troca a porta): login/logout, redefinição de senha, RBAC por perfil, vulnerabilidades, campanhas, usuários, configurações, treinamento, estações (lista, detalhe, RBAC), análise de arquivos (envio, veredito, segunda opinião, histórico com filtro, limite de 10 MB, colaborador só com as próprias) e layout mobile |
| **Real** | `cd baluarte-frontend && npm run test:e2e:real` | `e2e/real/*.spec.ts` | 19 testes contra a API real e o PostgreSQL: conta e operação (10: sessão, "Risco aceito", campanha, usuários, convite pelo Mailpit, troca de senha, conta inativada, preferências, redefinição, RBAC do colaborador na API), análise de arquivos (5: sem ClamAV → 503 na tela; com ClamAV: arquivo limpo com SHA-256 e segunda opinião desligada (B20), EICAR, histórico filtrado no servidor (B17), colaborador) e estações (4: inscrição simulando o osquery, lista e detalhe com programas e portas, "Verificar vulnerabilidades" (B14) contra OSV/NVD falsos, base fora do ar, RBAC) |

O modo real roda pelo orquestrador [`scripts/e2e-real.mjs`](scripts/e2e-real.mjs) (`node scripts/e2e-real.mjs` na raiz faz o mesmo; argumentos extras vão para o `playwright test`). Ele **sobe, roda e derruba** tudo, isolado da stack de desenvolvimento (nunca usa a `8080`, a `5173` nem o banco `baluarte`):

1. banco descartável `baluarte_e2e` no Postgres local (o `DATABASE_URL` do `backend/.env` com outro nome de banco; recusa servidor que não seja local): `prisma migrate reset` + `seed` + `seed:demo`;
2. OSV e NVD **falsos** em `127.0.0.1:8098` ([`scripts/e2e/bases-falsas.mjs`](scripts/e2e/bases-falsas.mjs)): o botão "Verificar vulnerabilidades" nunca consulta as bases públicas;
3. API em `:8097` com segredo do osquery gerado na hora (só desta instância), `JWT_SECRET` próprio, VirusTotal desligado (sem chave), cruzamento automático desligado e e-mail pelo Mailpit do Compose (`:1025`/`:8025`; sobe o serviço `mailpit` se ele não estiver no ar);
4. Vite em `:5200` com `VITE_USE_MOCKS=false` e proxy `/api` para a `8097`;
5. Playwright com `E2E_REAL=1`. **Com ClamAV** (clamd respondendo em `127.0.0.1:3310`), roda tudo com o antivírus e depois reinicia a API **sem** `CLAMAV_HOST` para o teste do 503 (tag `@sem-antivirus`). **Sem ClamAV**, uma rodada só e os testes que dependem dele ficam como *skipped*;
6. para API, Vite e bases falsas, apaga o banco e para o que tiver subido no Docker.

Variáveis: `E2E_CLAMAV` (`auto` padrão: usa se o clamd responder; `1` exige e sobe o perfil `antivirus` do Compose, que precisa de 3 a 4 GiB de RAM e baixa as assinaturas na primeira vez; `0` nunca), `E2E_DB_NAME` (precisa começar com `baluarte_e2e`), `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_BASES_PORT`, `E2E_MAILPIT_URL`, `E2E_KEEP_DB=1` (mantém o banco para investigar). Logs da API e do Vite em `%TEMP%/baluarte-e2e-real/`.

O arquivo de teste **EICAR** é montado **em memória** dentro do teste (`Buffer` a partir da string padrão, escrita em partes) e entregue direto ao `<input type="file">`: o repositório não contém a assinatura inteira e nada é gravado em disco (o antivírus da máquina não tem o que bloquear). A estação é inscrita pelas próprias rotas do agente (`/agentes/osquery/enroll` e `logger`), como o osquery faria.

Contra a stack Docker (sem o orquestrador): `E2E_REAL=1 E2E_BASE_URL=http://localhost:8081 npx playwright test` roda os 10 testes de conta e operação; os de arquivos pedem `E2E_CLAMAV` e os de estações pedem `E2E_OSQUERY_SECRET` (e `E2E_BASES_URL` para o "Verificar"), senão ficam como *skipped*.

## Endpoints (sob `/api`)

**Contrato (testado pelo Postman — não muda):** `POST /login` · `POST /scans` · `POST /assets` · `POST /users` · `POST /campaigns` (aceita também `destinatarios[]`) · `GET /findings/classificacao?cvss=`

**Leitura (alimentam as telas):** `GET /me` · `GET /dashboard` · `GET /assets` · `GET /scans[/:id]` (com progresso, B26) · `GET /vulnerabilidades[/:id]` (paginada no servidor e com histórico no detalhe, B25; + `PATCH`, inclusive status `Risco aceito`) · `GET /vulnerabilidades/relatorio.pdf` (B24, ver abaixo) · `GET /campanhas[/:id]` · `GET /usuarios` (com `departamento`) · `GET /departamentos` (Administrador/Analista) · `GET /estacoes[/:id]` (Administrador/Analista; ver abaixo) · `GET /configuracoes/seguranca` · `GET /treinamentos/:token` (protegido: o `:token` é o id do evento; Colaborador só o próprio)

**Achados:** cada vulnerabilidade traz `cwe`, `cve` (só em achado de componente), `cvssVetor` e `remediacao` (passos numerados com título, descrição e esforço). A nota `cvss` é calculada do vetor CVSS 3.1 (`src/cvss.ts`) e a severidade sai da nota; o scanner simulado sorteia tipos do catálogo em `src/catalogo.ts`.

**Varreduras:** `POST /scans` responde `EM_FILA` (contrato, sem campos novos); o status avança pelo tempo decorrido — em fila nos primeiros 5 s, em andamento até 20 s, concluída depois — e é gravado na primeira leitura de `GET /scans`, `GET /scans/:id`, `/dashboard` (de qualquer perfil), `/assets` ou `/vulnerabilidades` que perceber a mudança. Não há worker nem timer: é uma máquina de estados avaliada na leitura, o que funciona também na função serverless; para quem usa, o efeito é o de segundo plano (dispara, sai da tela e, ao voltar, o status avançou e os achados estão lá). O worker de verdade fica para o modo real (W01/W09). Os achados só aparecem quando a varredura conclui. Um ativo só recebe nova varredura depois que a anterior conclui (`409 VARREDURA_EM_ANDAMENTO`, RN-003).

**Progresso da varredura (B26; Administrador e Analista):** as leituras trazem, além do registro, `progresso` (0 na fila, 1 a 99 em andamento, 100 concluída), `etapa` (`Na fila` → `Mapeando superfície` → `Testando injeção` → `Testando autenticação` → `Gerando relatório` → `Concluída`, as quatro do meio distribuídas por igual nos 15 s de andamento) e `estimativaConclusao` (ISO 8601: criação + 20 s; na concluída, a data real). Tudo derivado de `criadoEm` e das constantes do ciclo, sem gravar nada novo (sem migration). `GET /scans/:id` devolve uma varredura só, no mesmo formato da lista (`401` sem token, `403 PERFIL_SEM_PERMISSAO` para Colaborador, `400 VARREDURA_ID_INVALIDO` fora de `[A-Za-z0-9_-]{1,64}`, `404 VARREDURA_NAO_ENCONTRADA`). A tela **Varreduras** (`/scans`) inicia e acompanha: barra de progresso acessível (`role="progressbar"`, `aria-valuenow`) com etapa e tempo estimado em cada varredura em curso, consultando a cada 3 s só as que estão em curso (`GET /scans/:id`, uma requisição leve por varredura em vez da lista inteira) e, ao concluir, um aviso com link para os achados. Usuários aceitam `departamento` (pelo nome) em `POST /users` e `PATCH /users/:id`; o relatório da campanha traz `porDepartamento`.

**E-mail simulado da campanha e seus links (públicos, sem login):** `POST /campaigns` envia a cada destinatário o e-mail do template (`urgencia`, `autoridade`, `curiosidade`; `src/campanhaEmail.ts`) com dois links para o frontend: `/t/<token>` (abre o treinamento) e `/t/<token>/reportar` (confirma o reporte). A resposta ganha `emailsEnviados`; só quem recebeu fica com `enviadoEm`. `GET /treinamentos/link/:token` (registra abertura e clique uma vez e entrega o treinamento, sem expor ids nem a campanha) · `POST /treinamentos/link/:token/concluir` · `POST /treinamentos/link/:token/reportar` (registra `reportouEm` e a abertura, sem clique; idempotente; `404 LINK_NAO_ENCONTRADO`). O relatório `GET /campanhas/:id` traz `reportes[]` e o funil `reportaram`. O token é aleatório (256 bits), gerado por destinatário ao criar a campanha, e no banco fica só o hash SHA-256. `POST /campaigns` só aceita destinatário cadastrado e não inativo (`422 DESTINATARIO_NAO_CADASTRADO`, conferido depois de formato e domínio).

**Análise de arquivos (B04, os três perfis):** `POST /arquivos/analise` (multipart, campo `arquivo`, até 10 MB; o arquivo passa em fluxo pelo ClamAV e é descartado, nada vai para disco; resposta com nome, tamanho, SHA-256 e o veredito "Nenhuma ameaça conhecida encontrada" ou "Ameaça encontrada: <nome>"; `413 ARQUIVO_MUITO_GRANDE`, `429 MUITAS_ANALISES` acima de 20 por hora, `503 ANTIVIRUS_INDISPONIVEL` sem o ClamAV) · `GET /arquivos/analises` (histórico; o Colaborador vê só o próprio; filtro e paginação abaixo, B17). O ClamAV roda no Compose com `docker compose --profile antivirus up -d` (pede 3 a 4 GiB de RAM).

**Histórico de análises e peso no dashboard (B17):** `GET /arquivos/analises?resultado=&pagina=&tamanho=` filtra por `resultado` (`LIMPO` ou `AMEACA`, exatamente assim; vazio = todos) e pagina no servidor (`pagina` a partir de 1, `tamanho` padrão 20, máximo 100), mais recente primeiro. `dados` continua sendo a lista de antes; o envelope ganha `resumo: { total, pagina, tamanho }` (total do mesmo critério). Sem parâmetro, vem a primeira página de 20. Parâmetro inválido dá 400 com código próprio (`RESULTADO_INVALIDO`, `PAGINA_INVALIDA`, `TAMANHO_INVALIDO`), inclusive objeto ou lista na query (`?resultado[$ne]=x`). O Colaborador vê só as próprias análises (o dono vem do login, nunca da query); Administrador e Analista veem todas, com quem enviou. No `GET /dashboard`, `kpis.arquivosMaliciosos` conta os **arquivos distintos por SHA-256** com `AMEACA` do ClamAV **nos últimos 30 dias**, de todos os usuários (o mesmo arquivo enviado várias vezes conta uma vez); cada um pesa como um achado crítico: soma em `kpis.criticas` e em `distribuicaoSeveridade['Crítico']`, não em `vulnerabilidadesAbertas` (soma da distribuição = vulnerabilidades abertas + arquivos maliciosos). A janela de 30 dias existe porque o arquivo é descartado e não tem status para "resolver". O número segue o nível de acesso dos outros KPIs técnicos: o Colaborador recebe `null` (B10, RN-006). A tela `/files` tem o filtro "Resultado" e a paginação; no dashboard, o card "Críticas" diz quantos arquivos inclui e a distribuição avisa que o Crítico os contém.

**Segunda opinião do VirusTotal (B20):** depois do ClamAV, a API consulta o relatório do arquivo **só pelo SHA-256** (`GET https://www.virustotal.com/api/v3/files/<sha256>`, chave em `VIRUSTOTAL_API_KEY`); o arquivo nunca é enviado ao VirusTotal. A resposta de `POST /arquivos/analise` e cada item de `GET /arquivos/analises` ganham `segundaOpiniao` (`{ fonte: 'VirusTotal', situacao, motivo, deteccoes, total, consultadoEm, link, mensagem }`, com `situacao` `MALICIOSO`, `SUSPEITO`, `SEM_DETECCAO`, `DESCONHECIDO` (o VirusTotal respondeu 404), `INDISPONIVEL` (cota, chave recusada, 429 do VirusTotal, tempo esgotado de 8 s ou falha) ou `DESLIGADO` (sem a chave); `null` nas análises anteriores ao B20). O veredito principal (`resultado`, do ClamAV) nunca muda por causa dela, e falha na consulta nunca derruba a análise. Cota gratuita respeitada no banco (tabela `VirusTotalLookup`: 4 por minuto, 500 por dia, como os limitadores de login); estourou, a resposta diz "Segunda opinião indisponível agora (cota)" sem consultar. O mesmo hash respondido nas últimas 24 h vem do histórico, sem gastar cota (`VIRUSTOTAL_COTA_MINUTO`, `VIRUSTOTAL_COTA_DIA`, `VIRUSTOTAL_CACHE_HORAS`, `VIRUSTOTAL_TIMEOUT_MS` ajustam).

**Conta e administração:** `POST /users` cria a conta `Pendente`, sem senha, e envia um **convite** por e-mail (link de 72 h para a pessoa criar a própria senha; conta pendente não entra por login) · `POST /users/:id/convite` (reenvia; Administrador/Analista) · `POST /users/:id/redefinir-senha` (Administrador envia o link de redefinição a uma conta ativa; não gasta o limite de pedidos do dono e audita quem pediu) · `POST /auth/link/verificar` (a tela confere o link antes de pedir a senha) · `POST /auth/change-password` (encerra as outras sessões e devolve um token novo para a atual) · `POST /auth/reset-password` (+ `/confirm`, que também aceita o convite e recusa a senha atual com `400 SENHA_REPETIDA`; link de uso único com validade de 30 min, 3 solicitações por e-mail a cada 15 min; redefinir encerra as sessões abertas antes e tira a conta do bloqueio) · `POST /auth/logout` (invalida os tokens emitidos antes, em todos os dispositivos) · `POST /auth/renovar` (sessão expira com 30 min sem uso; teto de 8 h desde o login) · `GET/PUT /configuracoes/notificacoes` · `POST /treinamentos/:token/concluir` · `PATCH/DELETE /users/:id` (Administrador; protege a própria conta e o último administrador com status `Ativo` (admin `Pendente` não conta); quem tem histórico de campanha não é excluído, só inativado) · `DELETE /campanhas/:id` (Administrador/Analista) · `POST /departamentos` e `DELETE /departamentos/:id` (Administrador; departamento com usuários não é excluído)

**Lista de vulnerabilidades (B25; Administrador e Analista):** `GET /vulnerabilidades?severidade=&status=&q=&pagina=&tamanho=&ordenar=&direcao=` filtra, ordena e pagina no banco. `pagina` a partir de 1; `tamanho` padrão 20, máximo 100; `ordenar` = `detectadoEm` (padrão), `cvss` ou `descricao`; `direcao` = `asc` ou `desc` (padrão). A ordem é estável (campo pedido, depois o mais recente, depois o id), então percorrer as páginas nunca repete nem pula achado. `resumo: { total, ativos, pagina, tamanho, porSeveridade, porStatus }` descreve o filtro inteiro, não a página. A busca `q` casa host, categoria, CVE ou programa (achados de estação, B14) e é literal (`%` e `_` não são curinga). Parâmetro inválido dá 400: `SEVERIDADE_INVALIDA`, `STATUS_INVALIDO`, `BUSCA_INVALIDA`, `PAGINA_INVALIDA`, `TAMANHO_INVALIDO`, `ORDENACAO_INVALIDA`, `DIRECAO_INVALIDA`. O detalhe (`GET /vulnerabilidades/:id`, e a resposta do `PATCH`) traz `origem` (varredura e ativo) e `historico: { eventos, statusAtual, completo }`: a detecção e as mudanças de status registradas na trilha de auditoria, com autor; `completo: false` quando a trilha não explica o status atual (mudança anterior a ela ou fora da plataforma), e a tela avisa em vez de inventar. Histórico em tabela própria e evolução de 30 dias ficam para o B25b (exigem migration). O frontend legado (`frontend/`) mostra só a primeira página.

**Nota de risco por ativo e ativos de maior risco (B25):** `GET /assets` traz, por ativo, `notaRisco` (0 a 100), `achadosAbertos` e `abertosPorSeveridade`. Fórmula: `min(100, 10 × críticos + 7 × altos + 4 × médios + 1 × baixos)`, contando só achados abertos ("Resolvida" e "Risco aceito" não entram); os pesos são o piso da faixa CVSS 3.1 de cada severidade. A nota não é gravada: é calculada a cada leitura, então muda assim que uma varredura conclui ou um status muda. `GET /dashboard` traz `ativosMaiorRisco` (até 5, só ativos com achado aberto; empate de nota decidido pelos pontos sem teto, depois por críticos, altos, médios e baixos, depois nome), para Administrador e Analista; o Colaborador recebe a lista vazia, como as demais listas técnicas (os KPIs técnicos dele vêm `null`). No frontend: card **Ativos de maior risco** no dashboard e coluna **Nota de risco** em `/assets`.

**Relatório de vulnerabilidades em PDF (B24, US-011; Administrador e Analista, os mesmos perfis da lista técnica):** `GET /vulnerabilidades/relatorio.pdf?severidade=&status=&q=` devolve `application/pdf` com `Content-Disposition: attachment; filename="baluarte-vulnerabilidades-AAAA-MM-DD.pdf"` e `Cache-Control: no-store`. Os filtros são os da lista (`severidade` Crítico/Alto/Médio/Baixo e `status` sem diferenciar maiúsculas; `q` no host, na categoria, no CVE ou no programa, até 100 caracteres), e o PDF **não pagina**: leva todos os achados do filtro, mesmo que a lista mostre só uma página (`pagina`/`tamanho` são ignorados aqui). Validados: valor desconhecido, repetido ou objeto dá 400 (`SEVERIDADE_INVALIDA`, `STATUS_INVALIDO`, `BUSCA_INVALIDA`) em vez de um PDF que parece filtrado sem estar. O PDF (A4 paisagem, gerado em memória com o `pdfkit` 0.17.2, sem binário nativo e sem gravar nada em disco) traz cabeçalho (Baluarte, data e hora de geração no horário de Brasília, quem gerou e os filtros), resumo (achados, ativos afetados, CVSS médio e máximo, contagem por severidade e por status) e a tabela dos achados ordenados por CVSS, do maior para o menor (ativo e nome, categoria OWASP — com o programa e a versão nos achados de estação, B14 —, CWE/CVE, nota e vetor, severidade, status e data), com o cabeçalho repetido a cada página e rodapé "Página X de Y". Não leva evidência, descrição nem remediação: só o que a lista já mostra. A exportação vai para a trilha como `EXPORTAR_RELATORIO_VULNERABILIDADES` (quantidade e filtros); filtro inválido e 403 não gravam. No frontend, o botão **Exportar PDF** da tela de vulnerabilidades baixa o arquivo com os filtros ativos.

**Auditoria (RN-008, só Administrador):** `GET /auditoria?acao=&usuarioId=&email=&de=&ate=&pagina=&tamanho=` devolve a trilha mais recente primeiro, paginada no servidor (`tamanho` padrão 20, máximo 100): `dados: [{ id, acao, detalhe, quando, usuario: { id, nome, email } | null }]` e `resumo: { total, pagina, tamanho, acoes }` (`acoes` = ações distintas já registradas, para o filtro). `de`/`ate` em ISO 8601 (`AAAA-MM-DD` ou data e hora; `ate` só com o dia vai até o fim dele). Parâmetro inválido dá 400 com código próprio (`ACAO_INVALIDA`, `USUARIO_INVALIDO`, `EMAIL_INVALIDO`, `DATA_INVALIDA`, `PERIODO_INVALIDO`, `PAGINA_INVALIDA`, `TAMANHO_INVALIDO`); Analista e Colaborador recebem 403. O autor sai do cadastro atual (o `AuditLog` não tem FK para `User`, para o registro sobreviver à exclusão da conta): conta excluída ou ação sem autor vem com `usuario: null`. A tela é `/audit` no frontend.

**Cadeia de hash, verificação e retenção (B29, RNF-002, só Administrador):** a aplicação só insere no `AuditLog`. Cada registro guarda o `hash` dele e o `hashAnterior` (o hash do registro anterior), numa ordem própria (`sequencia`): a trilha tem **cadeia de hash com verificação de integridade (detecta adulteração)**. Ela **não é imutável no banco**: a trava é pendência (ver "Trava no banco" abaixo).
- `GET /auditoria/integridade` recalcula a cadeia e responde `dados: { integra, registrosVerificados, travaNoBanco, primeiraQuebra?: { id, timestamp, motivo } }`. `motivo`: `CONTEUDO_ALTERADO` (o registro não confere com o próprio hash: foi alterado), `ELO_QUEBRADO` (o `hashAnterior` não é o hash do registro anterior: algo foi apagado, inserido ou reescrito antes dele) ou `SEM_HASH`. Para na primeira quebra. O primeiro registro é a âncora: o `hashAnterior` dele é aceito como está (nulo no início da cadeia, ou o hash do último registro apagado pela retenção), sem falso positivo. `travaNoBanco` diz se os triggers da trava existem e estão ativos (na `main`, `false`). A verificação é leitura e não entra na trilha (a tela a chama a cada carga; cada consulta viraria um registro novo na lista que o administrador está lendo). A tela `/audit` mostra o selo **"Cadeia íntegra"** (com a contagem e o estado da trava) ou o alerta **"Cadeia violada"** com o id, a data e o motivo da primeira quebra.
- `POST /auditoria/retencao` aplica a retenção de **12 meses** (`RETENCAO_MESES` em `models/auditoria.model.ts`; a função do banco recusa menos) e registra `APLICAR_RETENCAO_AUDITORIA` com a quantidade apagada, o corte e a âncora. Apaga só o **prefixo** da cadeia mais antigo que o corte, para a cadeia restante continuar contígua: um registro antigo gravado depois de um recente espera a próxima execução. `GET /configuracoes/seguranca` publica `retencaoMeses: 12` e `logImutavel: true` só quando a trava do banco está de fato ativa (consulta os triggers a cada leitura; na `main`, `false`).
- **Onde o hash é calculado:** no banco, no trigger `BEFORE INSERT` da migration `20261008170000_auditoria_cadeia_hash`, sob `pg_advisory_xact_lock` (duas gravações concorrentes nunca leem o mesmo "último hash"; a `sequencia` é tirada dentro do lock, então a ordem da sequência é a ordem da cadeia, coisa que o `timestamp` não garante). O que a aplicação mandar em `hash`, `hashAnterior` e `sequencia` é sobrescrito, e qualquer escrita (seed, teste, SQL) entra na cadeia. A verificação recalcula pela mesma função SQL (`auditoria_calcular_hash`): a fórmula existe num lugar só. Um índice único em `hashAnterior` impede bifurcação.
- **Serialização canônica (v1):** `hash = hex(sha256(utf8(m)))`, com `m = "baluarte-auditoria-v1|" + c(hashAnterior) + "|" + c(id) + "|" + c(usuarioId) + "|" + c(acao) + "|" + c(detalhe) + "|" + c(timestamp)`, onde `c(null) = "-"`, `c(texto) = <bytes UTF-8 do texto> + ":" + texto` e o timestamp é ISO 8601 em UTC com milissegundos (`2026-10-08T12:00:00.000Z`, o mesmo do `toISOString()`). O prefixo de tamanho torna a concatenação inequívoca. `tests/auditoria-integridade.test.ts` refaz o hash em Node com essa regra.
- **Registros que já existiam:** a migration os encadeia (backfill) em ordem de `timestamp` e `id`; o primeiro fica com `hashAnterior` nulo. Assim a trilha inteira é verificável desde o primeiro dia, sem caso especial para registro sem hash. As colunas novas são aditivas (`hash` e `hashAnterior` anuláveis, `sequencia` com default `0`): o código anterior ao B29 continua gravando, e o trigger preenche. O default é uma constante de propósito: só o trigger tira o `nextval` (dentro do lock), e um default `nextval` gastaria dois números por INSERT (a sequência pulava de 2 em 2 até a migration `20261008175000_auditoria_sequencia_sem_salto`; os saltos já gravados ficam, sem efeito na cadeia, porque a `sequencia` não entra no hash). No banco hospedado, a migration vai **antes do merge** (o Prisma novo lê essas colunas em todo `create`/`findMany` do `AuditLog`; ver a regra de ordem no CHANGELOG).
- **Sem a trava, o banco aceita alteração:** a aplicação nunca altera nem apaga, mas quem tiver a connection string consegue dar `UPDATE`/`DELETE` no `AuditLog`; a verificação acusa a mudança no registro alterado (ou no seguinte, se o hash dele também foi refeito). O hash não tem chave secreta: quem reescreve a cadeia inteira a partir do ponto alterado (um DBA) não é detectado sem uma âncora externa (ex.: publicar o último hash periodicamente).
- **Trava no banco (pendência, branch `feat/b29-trava`):** a migration `20261008176000_auditoria_imutavel` (triggers que recusam `UPDATE`, `DELETE` e `TRUNCATE`, exceto a retenção) e os testes dela ficam na branch `feat/b29-trava`, fora da `main` até o Leo decidir. Separada porque é uma porta de mão única (depois dela ninguém limpa o `AuditLog`, nem dado de demonstração) e porque o entrypoint do Docker/Railway roda `prisma migrate deploy` a cada subida: com a pasta no repositório, ela entraria no primeiro deploy. A função de retenção desta migration já liga a variável de sessão que o trigger da trava confere.
- **Agendar a retenção.** Não há cron dentro da API (ela também roda serverless). **Railway** (recomendado): um serviço cron com o mesmo código e as mesmas variáveis, comando `npm run auditoria:retencao` (mesmo service da rota; registra a retenção sem autor), agenda mensal como `0 3 1 * *`. **Vercel Cron**: só faz `GET` com `Authorization: Bearer $CRON_SECRET`, então exigiria uma rota própria para o cron (não existe hoje; a rota atual é `POST` com o JWT de um Administrador, que expira). **Supabase**: o `pg_cron` pode chamar `SELECT * FROM auditoria_aplicar_retencao(12)` direto, mas aí a retenção não entra na trilha. Enquanto nada disso estiver agendado, a retenção é aplicada à mão pela rota.

Erros seguem o envelope `{ status: "erro", mensagem, codigoErro, timestamp }`; sucessos, `{ status: "sucesso", mensagem?, dados, resumo? }`. Toda rota de escrita registra em `AuditLog`, inclusive as do contrato (`POST /assets` → `CRIAR_ATIVO`, `POST /scans` → `INICIAR_VARREDURA`, sem mudar a resposta), e a mudança de status de vulnerabilidade grava `ALTERAR_STATUS_VULNERABILIDADE` com status antigo → novo. A exportação do relatório em PDF, embora seja leitura, também é registrada (`EXPORTAR_RELATORIO_VULNERABILIDADES`).

As suítes de segurança em `backend/tests/seguranca/` exercitam a API com payloads reais (injeção, tokens adulterados, força bruta, corpos malformados); os achados que elas revelaram foram corrigidos no backend (coerção de query string, validação de tipo em campos obrigatórios, senha só como string, corpo grande com envelope 413, e o dashboard do colaborador sem métricas por campanha — RN-006).

**Agente de estação (osquery, B07):** o agente instalado nas estações é o [osquery](https://osquery.readthedocs.io/en/stable/deployment/remote/), falando com a API pelo plugin `tls`. As três rotas são públicas (sem JWT) e respondem no formato do osquery, não no envelope da API:

| Rota | Corpo (o osquery manda) | Resposta |
|---|---|---|
| `POST /api/agentes/osquery/enroll` | `{ enroll_secret, host_identifier, host_details: { os_version, system_info, ... } }` | `200 { node_key, node_invalid: false }` · segredo errado ou ausente: `401 { node_invalid: true, codigoErro: "SEGREDO_INVALIDO", ... }` · `OSQUERY_ENROLL_SECRET` ausente ou com menos de 16 caracteres: `503 { node_invalid: true, codigoErro: "INSCRICAO_DESLIGADA", ... }` |
| `POST /api/agentes/osquery/config` | `{ node_key }` | `200 { options, schedule, node_invalid: false }` · chave desconhecida: `200 { node_invalid: true }` (o osquery se reinscreve) |
| `POST /api/agentes/osquery/logger` | `{ node_key, log_type: "result" \| "status", data: [...] }` | `200 {}` · chave desconhecida: `200 { node_invalid: true }` |

Corpo fora do formato (chave que não é hexadecimal de 64 caracteres, `log_type` desconhecido, `data` que não é lista, `host_identifier` vazio ou com mais de 255 caracteres) recebe `400` com o envelope de erro e `node_invalid: true`. Chave desconhecida responde `200` de propósito: o osquery não lê o corpo de respostas fora de 2xx e só se reinscreve quando vê `node_invalid: true`.

- **Inscrição:** o segredo vem de `OSQUERY_ENROLL_SECRET` (nunca do código) e é comparado em tempo constante (`crypto.timingSafeEqual` sobre o SHA-256 dos dois lados). A chave da estação é aleatória (256 bits) e só o hash SHA-256 vai para o banco (`Workstation.nodeKeyHash`). A estação inscrita vira um ativo do tipo **"Estação de trabalho"**, que só a inscrição cria (`POST /assets` continua recusando o tipo com `TIPO_INVALIDO`). O host do ativo é o hostname da máquina; se já houver ativo com esse host, ganha um sufixo. A mesma estação (`host_identifier`) pode se reinscrever: recebe chave nova e a anterior deixa de valer. Toda inscrição vai para o `AuditLog` (`INSCREVER_ESTACAO`, com o `host_identifier`). Desligar a variável só fecha novas inscrições; estações já inscritas continuam enviando.
- **Configuração entregue:** seis queries agendadas como *snapshot* — programas instalados (`programs` no Windows, `deb_packages` (com o pacote-fonte, `source`) e `rpm_packages` (versão com a epoch) no Linux, `apps` no macOS, cada uma com o filtro `platform`), versão do SO (`os_version`) e portas em escuta (`listening_ports` + `processes`). Intervalos por categoria (B08), para a coleta não pesar na estação: **programas a cada 1 h, portas a cada 15 min e SO a cada 6 h** em produção (fora dela, 5 min, 75 s e 30 min), com `schedule_splay_percent` de 10% para as estações não coletarem juntas. O intervalo dos programas é o base: `OSQUERY_INTERVALO_S` (60 a 86400) muda; as portas rodam a 1/4 dele e o SO a 6x, sempre entre 60 s e 1 dia.
- **Resultados guardados:** só o inventário mais recente por estação. Cada snapshot substitui o anterior da mesma fonte: `WorkstationSoftware` (nome, versão, fonte, fornecedor), `WorkstationPort` (porta, TCP/UDP, endereço, processo) e o SO nos campos `sistema`/`so*` da `Workstation`. Toda requisição com chave válida atualiza `vistaEm`; resultado de inventário atualiza também `inventarioEm`. Eventos de outras queries e resultados diferenciais são ignorados. Coluna ausente numa linha vale como vazia (a linha não é descartada). O cruzamento com vulnerabilidades está logo abaixo (B14).
- **Corpo:** as rotas do agente aceitam até 2 MB (as demais, 64 kB) e qualquer `Content-Type`, inclusive gzip (`--logger_tls_compress`). O caractere NUL, que as outras rotas recusam (`400 CARACTERE_INVALIDO`), é **removido** dos valores nestas: o osquery manda strings de C com o terminador (no Linux, o `cpu_brand` da inscrição), e recusar deixaria a estação sem se inscrever (achado na validação do B08).

### Cruzamento com bases públicas de vulnerabilidades (B14)

Os programas inventariados em cada estação são comparados com bases públicas; cada vulnerabilidade com CVE **e** vetor CVSS 3.x vira um achado da estação, que entra no dashboard de risco técnico, em `GET /vulnerabilidades` e em `GET /scans` junto com os do scanner.

| Inventário | Base | Como |
|---|---|---|
| `deb_packages` no Debian e no Ubuntu; `rpm_packages` no AlmaLinux e no Rocky Linux | [OSV](https://osv.dev) | `POST /v1/querybatch` com ecossistema pelo SO da estação (`Debian:12`, `Ubuntu:22.04:LTS`, `AlmaLinux:9`, `Rocky Linux:9`); no deb, pelo pacote-fonte (`libssl3` → `openssl`), que é como o Debian e o Ubuntu indexam. Depois, `GET /v1/vulns/{id}` para o CVE, o vetor e a versão corrigida. Registro sem nota (comum no Debian) ou boletim com vários CVEs (USN/DSA): registro do próprio CVE no OSV e, se ainda faltar, o NVD (`cveId`) |
| `programs` no Windows | [NVD](https://nvd.nist.gov/developers/vulnerabilities) (API 2.0) | o nome que o instalador registra não bate com o catálogo oficial, então só os 21 programas da tabela `backend/src/models/tabelaCpe.model.ts` (Chrome, Edge, Firefox, 7-Zip, VLC, Notepad++, PuTTY, Git, Node.js...) viram CPE 2.3 com a versão normalizada e são consultados por `cpeName`. Programa fora da tabela não é consultado |
| RHEL, SUSE, macOS (`apps`) | — | sem cobertura (contam em `programasSemCobertura`) |

- **Achado:** categoria `A06:2021 - Vulnerable and Outdated Components`, CVE, CWE quando a base informa, vetor CVSS 3.1 (3.0 é convertido; métricas temporais saem), nota calculada do vetor e severidade pela nota, evidência (linha do inventário, registro e base), passos de remediação (com a versão corrigida, quando o OSV informa) e os campos `programa`, `programaVersao` e `baseVulnerabilidade`. Sem vetor 3.x em nenhuma base, o CVE não vira achado (conta em `semCvss`). Cada verificação com achado novo cria uma varredura já concluída no ativo da estação; estação + CVE + programa é único no banco, então nada se repete entre verificações.
- **Quando:** `POST /api/estacoes/:id/verificar` (Administrador/Analista; `:id` é o id da estação ou do ativo dela, no formato cuid) responde `200` com o resumo (`programasConsultados`, `programasSemCobertura`, `vulnerabilidadesEncontradas`, `achadosNovos`, `achadosExistentes`, `semCvss`, `pendentes`, `falhas`, `varreduraId`); `400 ID_INVALIDO`, `404 ESTACAO_NAO_ENCONTRADA`, `422 ATIVO_INATIVO`, `409 VERIFICACAO_EM_ANDAMENTO`. No frontend, o detalhe da estação (`/stations/:id`) tem o botão **Verificar vulnerabilidades**, mostra o resultado, a última verificação e os achados em aberto (com link para a lista filtrada pelo host). `GET /estacoes[/:id]` traz `verificadaEm`; o detalhe, `totalAchados` e `achadosAbertos`. Num servidor de longa duração (Docker, Railway), cada inventário de programas recebido dispara a verificação em segundo plano, sem segurar a resposta ao agente; na Vercel (a função congela depois de responder) e nos testes fica desligado. `CRUZAMENTO_AUTOMATICO=1` ou `0` força.
- **Cache:** tabela `VulnerabilityCache`, com validade de 24 h (`VULN_CACHE_HORAS`, 1 a 720). Resposta vazia também entra; falha não.
- **Falha da base externa:** fora do ar, erro, limite de requisições ou tempo esgotado (`VULN_TIMEOUT_MS`, padrão 15 s) vira log e `falhas: ["OSV"]`/`["NVD"]` na resposta, sem achado; o que a outra base confirmou entra, e o resto fica para a próxima verificação. O recebimento do inventário nunca cai por causa disso.
- **Limites por verificação:** até 300 registros novos do OSV e 5 consultas ao NVD sem chave (40 com `NVD_API_KEY`, que só vem do ambiente e vai no cabeçalho `apiKey`); o que não couber conta em `pendentes` e sai na próxima.
- **Auditoria:** `VERIFICAR_ESTACAO` (quem pediu) e `REGISTRAR_ACHADOS_ESTACAO` (toda escrita de achado, inclusive a automática).

### Como apontar o osquery para o Baluarte

Com os instaladores do B08 (pasta `agente/`): ver [Agente de estação](#agente-de-estação-osquery-b08), que instala o osquery oficial em versão fixa e grava as flags, a CA e o segredo. O modelo das flags, comentado, é [`agente/osquery.flags.modelo`](agente/osquery.flags.modelo).

### Estações monitoradas (B13)

Leitura, pelo painel, do que o agente registrou. Rotas no envelope da API (`estacao.*.ts`), separadas das rotas do protocolo do osquery, com `exigeToken` + Administrador ou Analista (Colaborador: `403 PERFIL_SEM_PERMISSAO`):

| Rota | Resposta |
|---|---|
| `GET /api/estacoes` | `dados[]`: `id`, `ativoId`, `nome`, `host`, `identificador` (host_identifier), `sistema`, `soNome`, `soVersao`, `soBuild`, `soPlataforma`, `status` (`Online`/`Offline`), `ultimoContato`, `inscritaEm`, `inventarioEm`, `totalProgramas`, `totalPortas`, por nome da máquina · `resumo`: `{ total, online, offline, janelaOfflineS }` |
| `GET /api/estacoes/:id` | os mesmos campos, `janelaOfflineS`, `programas[]` (`nome`, `versao`, `fornecedor`, `fonte`, por nome) e `portas[]` (`porta`, `protocolo`, `endereco`, `processo`, por número) · `:id` fora do formato do Prisma (cuid): `400 ID_INVALIDO` · estação inexistente: `404 ESTACAO_NAO_ENCONTRADA` |

- **Online ou offline** é calculado na leitura, nada é gravado: a estação está online enquanto o último contato do agente (`vistaEm`, atualizado em toda requisição com chave válida) estiver dentro de `CICLOS_ATE_OFFLINE` × intervalo de coleta (`models/estacao.model.ts`, hoje **3**). Com o intervalo padrão, a janela é de **3 h em produção e 15 min fora dela**; `OSQUERY_INTERVALO_S` muda as duas coisas juntas. Três intervalos e não um: o osquery fala pelo menos uma vez por intervalo (o snapshot de cada query agendada), mas o splay de 10%, o período do logger e uma coleta perdida não devem derrubar o status; três coletas seguidas sem contato, sim.
- O hash da chave da estação nunca sai na resposta.
- **Tela:** `/stations` no `baluarte-frontend/` (menu "Estações", só Administrador e Analista): lista com status e totais de online e offline; `/stations/:id` com abas de programas instalados (filtro por nome ou fornecedor, 25 por página) e portas abertas.

### RBAC efetivo (verificado no servidor, não só na interface)

| Perfil | Pode |
|---|---|
| **Administrador** | tudo, inclusive `GET /usuarios`, `PATCH/DELETE /users/:id`, `GET /auditoria`, `GET /auditoria/integridade` e `POST /auditoria/retencao` |
| **Analista** | operar a plataforma (varreduras, ativos, campanhas, status de vulnerabilidade, criar Analista/Colaborador), ler as listas técnicas, inclusive as estações monitoradas (`GET /estacoes[/:id]`), e exportar o relatório de vulnerabilidades em PDF; **não** lista nem edita usuários |
| **Colaborador** | `GET /me`, `GET /dashboard` (só o índice de resiliência a phishing: KPIs técnicos e distribuição por severidade vêm `null`, sem lista de achados nem métricas por campanha), `GET /configuracoes/seguranca`, as próprias notificações, o próprio treinamento e a análise de arquivos (só as próprias); nas listas técnicas (inclusive as estações monitoradas) e no relatório em PDF recebe `403 PERFIL_SEM_PERMISSAO` |

O perfil vem do banco a cada requisição (um token emitido antes de um rebaixamento deixa de valer), contas `Inativo` perdem o acesso na hora (401 `USUARIO_INATIVO`) e o login de conta inativa é recusado (403 `USUARIO_INATIVO`). O login bloqueia após 5 falhas por conta em 15 minutos (429 `MUITAS_TENTATIVAS`), como a política de `GET /configuracoes/seguranca` anuncia.

> Efeito colateral no frontend legado: a tela `/usuarios` dele agora precisa de um token de **Administrador** (com o analista do seed ela mostra "Erro ao carregar usuários"). As 6 suítes Robot não passam por essa tela — os formulários que elas exercitam validam no próprio navegador.

### Limitações conhecidas (decisões conscientes de escopo)

- **E-mail.** Convite, redefinição de senha e o e-mail simulado da campanha saem por um de três transportes (`src/config/email.ts`): **Brevo** (API HTTPS, com `BREVO_API_KEY`; usado no Railway, que bloqueia as portas de SMTP no plano Hobby), **SMTP** (`SMTP_HOST`: Mailpit do Compose em dev, caixa em `http://localhost:8025`, e o Gmail na Vercel) ou o log da API em dev sem nada configurado. O remetente vem de `EMAIL_REMETENTE` e, no Brevo, precisa estar verificado na conta. Sem SMTP, fora de produção, o e-mail inteiro vai para o log da API; em produção sem SMTP nada é enviado. O e-mail simulado da campanha segue a mesma regra (o `TREINAMENTO_LINK_CONSOLE` saiu): sem SMTP em dev o e-mail inteiro, com o link, vai para o log; em produção sem SMTP nada sai e o link nunca é impresso.
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
- Os dados ficam no PostgreSQL do servico `db` (volume `db-data`), publicado so em `127.0.0.1:5432`. A senha vem de `POSTGRES_PASSWORD` no `.env` da raiz; sem ela o compose nao sobe. Na **primeira** subida o entrypoint aplica as migrations (`prisma migrate deploy`, que nunca apaga dados), roda o seed de contrato (`SEED_CONTRATO=0` desliga: ele cria contas com as senhas públicas acima, então não vai para produção) e o `seed:demo` (`SEED_DEMO=0` desliga); nas seguintes so aplica migrations pendentes e o seed de contrato (idempotente).
- **Depois de um `db:reset` com a API no ar, reinicie a API** (`docker compose restart backend`): o reset recria a extensao `citext` e as conexoes abertas ficam com o tipo antigo em cache (`cache lookup failed for type`).
- **Sem segredo no repositorio:** se `JWT_SECRET` nao vier do `.env`, o entrypoint gera um aleatorio e o guarda no volume (`/data/jwt.secret`), entao as sessoes sobrevivem a reinicios sem nenhum valor fixo versionado. Com `NODE_ENV=production` a API se recusa a subir sem um segredo forte.
- `app` faz o build de producao de `baluarte-frontend/` e o serve com Nginx, encaminhando `/api` para o servico `backend` (`baluarte-frontend/nginx/`); so sobe depois do healthcheck da API. A API roda como usuario `node`, nao como root.
- Para as suites Newman/Robot contra o Docker, suba com um banco limpo: `docker compose down -v && SEED_DEMO=0 docker compose up --build -d`.

### HTTPS local (B06)

Em produção o HTTPS vem da plataforma (Vercel, Railway). No ambiente local e na demonstração, o Nginx do serviço `app` atende HTTPS na **8443** com uma autoridade certificadora (CA) local, o que também é pré-requisito do agente osquery (ele só fala TLS). **Sem certificado nada muda**: o `app` sobe só em HTTP na 8081, como antes.

```bash
sh scripts/gerar-certificados.sh            # Git Bash no Windows; usa o openssl da máquina
sh scripts/gerar-certificados.sh --docker   # alternativa sem openssl instalado (contêiner Alpine)
docker compose up --build -d app            # se o app já estava no ar: docker compose restart app
curl --cacert certs/ca.crt https://localhost:8443/
curl --cacert certs/ca.crt "https://localhost:8443/api/findings/classificacao?cvss=9.8"
openssl s_client -connect localhost:8443 -CAfile certs/ca.crt </dev/null | grep -E "Protocol|Verify"
```

- **Arquivos** (pasta `certs/`, fora do git): `certs/ca.crt` (certificado da CA, o único que se distribui), `certs/ca.key` (chave da CA, **nunca** sai da máquina), `certs/servidor/servidor.crt` e `servidor.key` (montados no Nginx; o contêiner não vê a chave da CA). Rodar o script de novo refaz o certificado do servidor e reaproveita a CA; `--nova-ca` troca a CA. O certificado vale para `localhost`, `app`, `host.docker.internal`, o nome da máquina, `127.0.0.1` e `::1`; para um agente em outra máquina, acrescente o endereço dela: `EXTRA_SAN="IP:192.168.0.10,DNS:pc-do-leo.lan" sh scripts/gerar-certificados.sh`.
- **A CA só vale para nomes locais** (name constraints: `localhost`, `app`, o nome da máquina, `*.local`, `*.lan`, `*.internal`, `*.home.arpa`, loopback e IPs privados). Se a chave vazar, um certificado emitido com ela para um site público é recusado pelos navegadores atuais e pelo OpenSSL, mesmo onde a CA foi instalada. Um nome fora dessa lista exige `--nova-ca` com o nome em `EXTRA_SAN` (o script avisa).
- **Portas e variáveis** (`.env` da raiz): `8081` HTTP, `8443` HTTPS (`HTTPS_PORT`). `HTTPS_REDIRECT=1` faz a 8081 só redirecionar (`308`) para o HTTPS; o padrão é `0` porque o Playwright em modo real, o Newman e este README usam `http://localhost:8081`. `HSTS_MAX_AGE` (padrão 1 ano) vale só no HTTPS e **não é enviado para `localhost`**: HSTS vale para o nome em todas as portas e quebraria a 8081, a 3000, a 5173 e a 8025, que são HTTP. Em `https://app:8443` ou pelo nome da máquina ele sai. Para os links dos e-mails apontarem para o HTTPS, `FRONTEND_URL=https://localhost:8443`.
- **TLS 1.3 e 1.2** (RNF-001), HTTP/2; TLS 1.1 ou menor é recusado.
- **curl do Windows** (Schannel, o do Git Bash e o do `System32`) falha com "revocation status is unknown", porque a CA local não publica lista de revogação: use `curl --ssl-revoke-best-effort --cacert certs/ca.crt ...`.
- **Dev server do Vite em HTTPS** (opcional): `DEV_HTTPS=1 npm run dev` em `baluarte-frontend/` usa o mesmo certificado (`https://localhost:5173`).

**Confiar na CA no navegador** (para a demonstração em `https://localhost:8443` sem aviso). Instale só o `certs/ca.crt`, nunca a chave, e remova depois da apresentação.
- Windows (Chrome e Edge usam o repositório do Windows; sem administrador): `certutil -user -addstore Root certs\ca.crt`. Para remover: `certutil -user -delstore Root "Baluarte CA local"`.
- Firefox: Configurações → Privacidade e segurança → Certificados → Ver certificados → Autoridades → Importar `certs/ca.crt` → marcar "Confiar nesta CA para identificar sites".
- macOS: `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db certs/ca.crt`.
- Linux (Chrome/Chromium): `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Baluarte CA local" -i certs/ca.crt`.

**Agente osquery.** O instalador do agente leva só o `certs/ca.crt` e o aponta nas flags de TLS do osquery:
```
--tls_server_certs=<caminho>/ca.crt   # ex.: C:\Program Files\osquery\certs\baluarte-ca.crt
--tls_hostname=<host>:<porta>         # sem https://; precisa estar no certificado
```
`<host>:<porta>` é `localhost:8443` com o agente na mesma máquina, `192.168.0.10:8443` (ou o nome da máquina) com o agente em outra máquina (gere o certificado com esse endereço em `EXTRA_SAN` e libere a 8443 no firewall) e `app:443` com o agente num contêiner da mesma rede do compose. Os caminhos de cadastro, configuração e envio de dados (`--enroll_tls_endpoint`, `--config_tls_endpoint`, `--logger_tls_endpoint`) são as rotas `/api/agentes/...` do servidor do osquery, encaminhadas à API pelo mesmo proxy `/api`. Quem grava isso tudo na estação são os instaladores da seção seguinte.

## Agente de estação (osquery, B08)

O agente é o [osquery](https://osquery.io) oficial, sem nada compilado por nós. A pasta [`agente/`](agente/) tem o que vai para a estação:

| Arquivo | Para quê |
|---|---|
| `osquery-versao.conf` | versão **fixa** (5.23.1) e o SHA-256 de cada pacote oficial (`.deb` amd64/arm64 e `.msi`), conferidos contra o digest da release no GitHub e contra o pkg.osquery.io |
| `osquery.flags.modelo` | flags comentadas: servidor, CA, segredo, plugins `tls` de configuração e logger, `--config_refresh`, `--disable_distributed`, extensões/eventos/carver desligados, watchdog |
| `instalar-agente.sh` / `desinstalar-agente.sh` | Debian/Ubuntu: `.deb` oficial, flags em `/etc/osquery`, serviço `osqueryd` do systemd |
| `instalar-agente.ps1` / `desinstalar-agente.ps1` | Windows: `.msi` oficial (hash **e** assinatura Authenticode da osquery/LF Projects), arquivos em `C:\Program Files\osquery\`, serviço `osqueryd` |

**O que é coletado e quando** vem do servidor (B07), não da estação: programas instalados a cada 1 h, portas em escuta a cada 15 min e versão do SO a cada 6 h (com splay de 10%; ver "Configuração entregue" acima). Só o inventário mais recente fica guardado: cada ciclo substitui o anterior, sem duplicar (teste `B08: o mesmo inventário enviado a cada ciclo...` em `backend/tests/agente.test.ts`). No Linux, o serviço do pacote oficial ainda limita o `osqueryd` a 20% de uma CPU (`CPUQuota` do systemd) e o watchdog do osquery reinicia o processo de trabalho se ele passar dos limites de memória e CPU.

**SO da demonstração:** os dois instaladores estão prontos; a escolha é do Leo. Linux (Ubuntu/Debian) é o caminho validado de ponta a ponta (abaixo) e o que mais rende no B14 (o OSV cobre todos os pacotes). No Windows, o B14 só consulta os 21 programas da tabela de CPE (NVD), e a instalação real ainda precisa ser feita numa máquina ou VM.

### Instalar

Pré-requisitos no servidor: HTTPS do B06 no ar (`sh scripts/gerar-certificados.sh`, com o endereço da estação em `EXTRA_SAN` se ela for outra máquina, e a 8443 liberada no firewall) e `OSQUERY_ENROLL_SECRET` no `.env` da API (`openssl rand -hex 32`). Leve para a estação a pasta `agente/` e **só** o `certs/ca.crt` (nunca a `ca.key`). O segredo nunca vai no comando nem no repositório: o instalador lê de `BALUARTE_ENROLL_SECRET`, de um arquivo (`--segredo-arquivo`, Linux) ou pergunta sem eco, e grava num arquivo legível só pelo administrador (Linux: `/etc/osquery/baluarte.secret`, root, 600; Windows: `C:\Program Files\osquery\baluarte.secret`, só SYSTEM e Administradores).

```bash
# Debian/Ubuntu (baixa o .deb oficial e confere o SHA-256; --pacote <arquivo.deb> usa um já baixado)
sudo sh agente/instalar-agente.sh --servidor 192.168.0.10:8443 --ca certs/ca.crt
```
```powershell
# Windows, PowerShell como Administrador (-Msi <arquivo.msi> usa um já baixado)
powershell -ExecutionPolicy Bypass -File agente\instalar-agente.ps1 -Servidor 192.168.0.10:8443 -CaCert certs\ca.crt
# Ensaio sem instalar nada (nem precisa de administrador): baixa, confere hash e assinatura e mostra as flags
powershell -ExecutionPolicy Bypass -File agente\instalar-agente.ps1 -Servidor 192.168.0.10:8443 -CaCert certs\ca.crt -SomenteConferir
```
Com certificado público (API no Railway), omita `--ca`/`-CaCert` e use `--servidor <domínio>:443`: o agente confia nas autoridades do próprio pacote do osquery. Rodar o instalador de novo atualiza flags, CA e segredo e reinicia o serviço.

**Conferir na estação:** Linux, `systemctl status osqueryd` e `journalctl -u osqueryd -f`; Windows, `Get-Service osqueryd`. Teste manual com o serviço parado: `osqueryd --flagfile <flags> --verbose` mostra a inscrição e os envios. No painel, a estação aparece em **Estações** logo após a inscrição, e o inventário chega no primeiro ciclo.

### Validar sem instalar nada na máquina (contêiner)

```bash
sh scripts/validar-agente-docker.sh            # Git Bash; ~5 min na primeira vez (build das imagens)
sh scripts/validar-agente-docker.sh --manter   # deixa a stack no ar para olhar
```
Sobe uma stack **descartável** (`scripts/validacao-agente/compose.yml`, projeto `baluarte-validacao-agente`): Postgres em tmpfs, a API e o Nginx (HTTPS do B06) deste repositório, OSV/NVD **simulados** e um Ubuntu 24.04 (imagem fixada por digest) que roda o `instalar-agente.sh` de verdade com o `.deb` oficial e depois o `osqueryd`, apontando para `https://app:443` com uma CA gerada só para a validação. Nenhuma porta é publicada e a rede não tem saída para a internet: não colide com a stack principal (8080, 5432, 8443) e o OSV/NVD de verdade nunca são consultados. A conferência (`conferir.mjs`) fala com a API pelo mesmo HTTPS e confere inscrição, inventário (programas, SO, portas), `GET /api/estacoes`, um segundo ciclo sem duplicar e a verificação do B14 (`POST /api/estacoes/:id/verificar`) duas vezes, contra uma vulnerabilidade **fictícia** (`CVE-2099-0001` no `glibc`). No fim, derruba tudo e apaga a CA, as chaves e os segredos.

Uma consulta **real** ao OSV, se quiser (uma vez, fora da validação automática): com a stack principal e uma estação Ubuntu inscrita, `POST /api/estacoes/<id>/verificar` sem `OSV_API_URL` no ambiente da API. O resultado fica em cache por 24 h.

### Desinstalar

```bash
sudo sh agente/desinstalar-agente.sh            # para o serviço, purge do pacote, apaga flags, CA, segredo e o banco local
```
```powershell
powershell -ExecutionPolicy Bypass -File agente\desinstalar-agente.ps1          # -WhatIf mostra sem fazer
```
O banco local do osquery (`/var/osquery/osquery.db`, `C:\Program Files\osquery\osquery.db`) guarda a chave da estação, por isso também é apagado. No painel a estação continua listada, com o histórico e os achados, e passa a Offline depois de 3 intervalos.

### Antivírus (Windows Defender): o que observar

Só numa máquina real. Não crie exclusão de antivírus para o agente: se algo bloquear, registre e decida depois.
1. Antes: `Get-MpComputerStatus | Select-Object AMRunningMode, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated` (proteção em tempo real ligada e assinaturas em dia).
2. Durante a instalação: aviso do SmartScreen ou do Defender. O instalador já recusa MSI com hash ou assinatura diferentes; `Get-AuthenticodeSignature "C:\Program Files\osquery\osqueryd\osqueryd.exe"` deve dar `Valid`, emitido para "OSQUERY a Series of LF Projects, LLC".
3. Depois de 15 a 60 min de serviço no ar: `Get-Service osqueryd` continua `Running`; `Get-MpThreatDetection` não traz nada do osquery; **Segurança do Windows → Proteção contra vírus e ameaças → Histórico de proteção** sem itens; e no log do Defender nenhum evento de detecção (1006, 1007, 1116, 1117), de regra de redução da superfície de ataque (1121, 1122) ou de acesso controlado a pastas (1123, 1124):
   ```powershell
   Get-WinEvent -LogName 'Microsoft-Windows-Windows Defender/Operational' -MaxEvents 200 |
     Where-Object { $_.Id -in 1006,1007,1116,1117,1121,1122,1123,1124 } | Format-List TimeCreated, Id, Message
   ```
4. No painel: a estação aparece, o inventário chega e ela segue Online.
5. Se houve bloqueio: anote o evento (id, arquivo, regra), confira a assinatura do arquivo bloqueado e só então decida (restaurar, exclusão pontual documentada ou outro SO para a demonstração).

## Deploy da API no Railway

Roteiro completo (serviço, variáveis, migração dos dados do Supabase, troca no frontend) em [`docs/DEPLOY-RAILWAY.md`](docs/DEPLOY-RAILWAY.md).

## Estrutura

```
backend/            API real (Express + Prisma/PostgreSQL)
  prisma/           schema + seed (contrato) + seed-demo
  src/              arquitetura em camadas: rota → controller → service → repository
                    (um arquivo por funcionalidade em cada camada: auth, usuario, departamento, ativo,
                    varredura, vulnerabilidade, campanha, treinamento, dashboard, notificacao, auditoria,
                    agente, estacao)
    app.ts          o app Express (fica aqui porque a Vercel o procura neste caminho)
    server.ts       sobe o servidor HTTP
    routes/         index.ts (roteador /api, ordem de registro) + <f>.routes.ts: caminho + middlewares + controller
    controllers/    <f>.controller.ts: uma função por endpoint (lê req, valida com o model, chama o service, responde)
    services/       <f>.service.ts: regra de negócio (+ token, linkConta, cvss, cicloVarredura, campanhaEmail,
                    campanhaMetricas, auditoria, relatorioVulnerabilidade, relatorioPdf, riscoAtivo,
                    cruzamento, baseVulnerabilidade)
    models/         <f>.model.ts: tipos do domínio, DTOs e regras zod de entrada (+ dominio, catalogoAchado, cruzamento, tabelaCpe)
    repositories/   <f>.repository.ts: único acesso ao Prisma
    middlewares/    auth.middleware.ts: exigeToken, exigePerfil
    config/         cliente Prisma, transportes de e-mail (Brevo/SMTP/Mailpit) e clientes do clamd, do OSV e do NVD
    utils/          envelope de resposta, schemas zod, validação e tokens de link
  tests/            unidade (tests/unidade, sem banco) + integração e pentest (node:test) com banco isolado
baluarte-frontend/  SPA React do produto (mocks ou backend real) — ver README próprio
frontend/           SPA legado (telas do Figma) — alvo das suítes Robot
agente/             instaladores do agente osquery (Linux .sh, Windows .ps1), versão fixa + SHA-256, modelo de flags (B08)
scripts/            gerar-certificados.sh (B06), validar-agente-docker.sh + validacao-agente/ (B08)
e2e/                6 suítes Robot apontando para o frontend legado
testes-api/         collection + environment do Postman
testes/             materiais originais da N2 AT1 (stubs, evidências)
```
