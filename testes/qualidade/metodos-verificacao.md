# Métodos de verificação do Baluarte

Inventário dos métodos usados para verificar o sistema: o que cada um verifica, onde está, como é executado e o número mais recente. Os números marcados como **medido em 14/10/2026** foram obtidos depois do rebase da branch `feat/mel-seg` sobre a `main` `84cacd1` (contagens do backend e Newman); os marcados como **medido em 13/10/2026** foram obtidos na primeira rodada desta revisão, sobre a `main` `4d5581a` acrescida dos testes do cartão #13 e #23 (branch `feat/mel-seg`), numa máquina Windows 11 com Node 24.16.0 e PostgreSQL 16 em contêiner. Os demais trazem a data e a fonte da última medição registrada; não foram repetidos nesta revisão, e a seção "Lacunas" explica por quê.

Convenções: "verde" significa zero falhas; nenhuma execução usa a porta 8080, a 5173, o banco `baluarte` ou o ambiente de produção.

## 1. Testes de unidade (backend)

- **O que verifica:** regras puras, sem banco nem servidor: CVSS 3.1 a partir do vetor, catálogo de achados, ciclo e progresso da varredura simulada, política de senha, tokens, JWT e RBAC do middleware, validação zod e ordem das regras do contrato, métricas de campanha, nota e índice de risco, relatório em PDF, leitura das respostas do OSV e do NVD, regras YARA próprias, clientes HTTP contra servidores falsos locais.
- **Onde:** `backend/tests/unidade/`.
- **Como rodar:** `cd backend && npm run test:unidade`; com cobertura, `npm run cobertura:unidade` (falha abaixo de 75% de linhas, 85% de ramos e 70% de funções sobre os arquivos de regra).
- **Número atual (medido em 14/10/2026):** 190 testes, 190 aprovados. Cobertura dos arquivos de regra (medida em 13/10/2026, com 179 testes): 93,3% de linhas, 93,2% de ramos, 85,3% de funções.

## 2. Testes de banco

- **O que verifica:** o que o banco garante sozinho, independentemente da aplicação: restrições CHECK, colunas `citext`, cascata e restrição de chaves estrangeiras, permissões fechadas para os papéis da API REST do Supabase (DT13, com os papéis simulados numa transação desfeita).
- **Onde:** `backend/tests/banco.test.ts` e `backend/tests/permissoes-papeis.test.ts`.
- **Como rodar:** fazem parte de `cd backend && npm test` (precisam do Postgres local; cada arquivo recria o próprio banco `baluarte_test_<arquivo>` pelas migrations).
- **Número atual (medido em 14/10/2026):** 10 testes, 10 aprovados.

## 3. Testes de integração (backend)

- **O que verifica:** a API real (Express + Prisma) contra um PostgreSQL de verdade, rota por rota: contrato da N2 AT1, dashboard agregado no banco, evolução de 30 dias, histórico de status, trilha de auditoria com cadeia de hash e trava contra alteração, cruzamento das estações com OSV e NVD falsos, análise de arquivos com clamd falso, segunda opinião do VirusTotal falsa, aviso de monitoramento, campanhas, treinamento, conta por convite, relatórios.
- **Onde:** `backend/tests/*.test.ts` (fora de `unidade/` e `seguranca/`); apoio em `backend/tests/helpers.ts`.
- **Como rodar:** `cd backend && TEST_DB_PREFIXO=<prefixo>_ npm test`. Cobertura de toda a suíte: `npm run cobertura` (falha abaixo de 90% de linhas, 85% de ramos e 90% de funções); relatório consolidado: `npm run test:relatorio`.
- **Número atual (medido em 14/10/2026):** 448 testes, 448 aprovados; a suíte completa do backend tem 794 testes, todos aprovados. Cobertura da suíte completa (medida em 13/10/2026, com 747 testes, não repetida): 99,2% de linhas, 94,4% de ramos, 99,3% de funções.

## 4. Pentest automatizado (backend)

- **O que verifica:** ataques reais contra a API real, cada um com banco isolado:
  - injeção (SQL, NoSQL, prototype pollution, mass assignment, NUL, JSON malformado): `injecao.test.ts`;
  - autenticação e autorização (token forjado, `alg=none`, payload adulterado, escalada vertical e horizontal, IDOR, perfil defasado no token, ciclo de sessão; matriz completa do `POST /assets`, cartão #23): `autorizacao.test.ts`;
  - força bruta e enumeração, inclusive rajadas paralelas contra os limites (DT09): `conta-forca-bruta.test.ts`, `limite-rajada.test.ts`, `limite-rajada-analise.test.ts`;
  - validação de entrada: `validacao-dados.test.ts`;
  - exposição de informação (cabeçalhos do helmet, CORS, stack trace, segredos no corpo, RBAC no payload): `exposicao-infra.test.ts`;
  - XSS armazenado e refletido (cartão #13): `xss-armazenado.test.ts`;
  - classes sem superfície alcançável (command injection não aplicável; XXE com parser presente, mas inalcançável), com a evidência guardada como teste (cartão #13): `superficie-nao-aplicavel.test.ts`.
- **Onde:** `backend/tests/seguranca/`.
- **Como rodar:** `cd backend && npm run test:seguranca` (ou junto de `npm test`).
- **Número atual (medido em 14/10/2026):** 146 testes, 146 aprovados (eram 126; +4 do cartão #23, +6 de XSS, +10 de command injection e XXE).

### 4.1 Cartão #23: `POST /assets` por perfil

A regra já estava coberta em partes: o 401 sem token e o 403 do Colaborador em `autorizacao.test.ts`, o 201 do Analista em `validacao-dados.test.ts`. O bloco "POST /assets — matriz de perfis" reúne a matriz num lugar só e acrescenta o que faltava: a recusa não deixa rastro (nenhum ativo e nenhum registro `CRIAR_ATIVO`), o Colaborador recebe 403 mesmo com corpo vazio (a autorização vem antes da validação e não revela as regras), e Analista e Administrador recebem 201 com o ativo e a auditoria gravados.

### 4.2 XSS armazenado (cartão #13)

A API guarda o texto do usuário como texto e o devolve só em JSON. Ela não higieniza nem escapa HTML, por decisão: escapar no servidor deformaria o dado e causaria dupla codificação; quem escapa é o React, na hora de desenhar. O teste `xss-armazenado.test.ts` usa seis payloads clássicos (`<script>`, `<img onerror>`, `<svg onload>`, `<iframe srcdoc>`, `javascript:` e injeção de template) e confere, em cada resposta que os carrega, `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, CSP `default-src 'none'` e o valor literal, byte a byte, inclusive no banco. Campos cobertos: nome e descrição do ativo; nome de usuário no cadastro, na lista, no `/me` e na edição; nome de departamento; nome de campanha na criação, na lista e no relatório (com o departamento do destinatário); detalhe e autor na trilha de auditoria. O e-mail simulado da campanha também foi conferido: o tipo `Email` só tem `para`, `assunto` e `texto` (não existe campo HTML), e o nome do destinatário vai como texto literal. Payload no caminho, num parâmetro inválido e na busca da lista de vulnerabilidades não volta na resposta (as mensagens de erro são fixas).

**No frontend (entregue pela sessão Frontend, fora desta branch):** o teste `baluarte-frontend/src/__tests__/xss.test.tsx` desenha a lista de ativos, a tabela de vulnerabilidades e o detalhe de uma vulnerabilidade (visão geral, evidências, remediação e histórico) com os mesmos payloads e prova que nenhum `<script>`, `<iframe>`, `<img src="x">`, atributo `on*` ou `href` com `javascript:` vira DOM, e que o texto aparece literal; a referência `javascript:` de um achado aparece como texto, nunca como link (`isHttpUrl` em `VulnDetailPage.tsx`). Enquanto esse teste não chega à `main`, o escape do lado do frontend é só o do React, sem teste de payload próprio.

**Grep registrado (13/10/2026):** em `baluarte-frontend/src/`, zero ocorrências de `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` e `new Function(`. Os únicos `href` dinâmicos são os de `manageHref` no dashboard (caminhos internos fixos), o link do VirusTotal (montado com o SHA-256) e as referências do achado, filtradas por `isHttpUrl`. O mesmo grep vira o último teste de `xss.test.tsx`, quando a sessão Frontend o entregar.

### 4.3 Command injection não aplicável; XXE com superfície presente, mas inalcançável (cartão #13)

- **Command injection:** a API não executa processo nem shell. Grep em `backend/src/` (13/10/2026): nenhuma importação de `child_process` e nenhuma chamada a `exec`, `execSync`, `execFile`, `spawn`, `spawnSync` ou `fork`; a única ocorrência de `exec(` é `RegExp.prototype.exec` em `utils/validacao.ts:51`. Também não há `eval`, `new Function` nem módulo `vm`. O agente osquery recebe só as consultas fixas de `QUERIES` (`models/agente.model.ts`), nunca texto de requisição. O `child_process` aparece apenas em ferramentas de desenvolvimento fora da API (`backend/scripts/carga.mjs`, `scripts/e2e-real.mjs`, `scripts/sonarqube.mjs`, `baluarte-frontend/scripts/e2e-navegadores.mjs` e o `helpers.ts` dos testes), sem entrada de usuário.
- **XXE (superfície presente, mas inalcançável):** há um parser de XML no `package-lock.json` do backend: o `saxes` 5.0.1, com o `xmlchars`, trazido pelo `exceljs` 4.4.0 do relatório em Excel (melhoria #17). O exceljs usa o saxes só para **ler** planilhas; o Baluarte só **escreve** (`wb.xlsx.writeBuffer` em `services/relatorioExcel.service.ts`) e nunca faz parse de XLSX ou XML vindo de fora. Nenhum arquivo de `backend/src/` importa parser de XML; só `relatorioExcel.service.ts` importa o exceljs, e nenhum arquivo chama API de leitura dele (`xlsx.read`, `xlsx.load`, `xlsx.readFile`, `csv.read`, `csv.readFile`, `stream.xlsx.WorkbookReader`). No lockfile, `saxes` e `xmlchars` são uma exceção explícita e só chegam pela cadeia `exceljs` → `saxes` → `xmlchars`; qualquer outro pacote de XML derruba o teste. **Segunda camada**, conferida no código-fonte do saxes 5.0.1 (`node_modules/saxes/saxes.js`): o texto do DOCTYPE e do DTD só é percorrido e entregue ao evento `doctype` (`sDoctype`, `sDTD`), sem declarar entidade; `parseEntity` só resolve o que está em `parser.ENTITIES`, que nasce com as cinco entidades predefinidas (`XML_ENTITIES`), e marca "undefined entity." para qualquer outra; o módulo só importa o `xmlchars`, sem `fs` nem rede. O README do saxes diz o mesmo na seção "Regarding `<!DOCTYPE` and `<!ENTITY`". Um teste roda o saxes com `<!ENTITY x SYSTEM "file:///etc/passwd">` e confere o erro "undefined entity" e o texto literal `&x;`. Os parsers de corpo da API são só `express.json`. Um corpo XML com entidade externa enviado como `application/xml` é ignorado em `POST /login` (400 `EMAIL_OBRIGATORIO`) e falha como JSON na rota do agente, que aceita qualquer Content-Type (400 `JSON_INVALIDO`), sem eco. No frontend não há `DOMParser` nem `parseFromString`. O ClamAV lê arquivos enviados, inclusive formatos baseados em XML, mas roda em outro contêiner e nunca devolve o conteúdo.
- **Evidência executável:** `backend/tests/seguranca/superficie-nao-aplicavel.test.ts` repete esses greps, confere a cadeia do lockfile, roda o saxes contra a entidade externa e envia o XML à API real. Se alguém introduzir a superfície (ou tornar o parser alcançável, com uma leitura de planilha, por exemplo), o teste falha e a classe passa a precisar de teste próprio. Controle negativo (14/10/2026, desfeito em seguida): acrescentar `wb.xlsx.load(...)` em `relatorioExcel.service.ts` e um `import ... from 'saxes'` em `src/` derrubou os dois testes de código.

## 5. Contrato com Newman (N2 AT1)

- **O que verifica:** as 6 rotas do contrato (`POST /login`, `/scans`, `/assets`, `/users`, `/campaigns` e `GET /findings/classificacao`), com as mensagens e os códigos de erro originais.
- **Onde:** `testes/api/postman/Baluarte-N2AT1.postman_collection.json` (cópia em `testes-api/`).
- **Como rodar:** numa instância isolada, com banco descartável e recém-semeado: exportar `DATABASE_URL` **e** `DIRECT_URL` com o banco `baluarte_contract_<prefixo>` (o `prisma migrate reset` usa o `DIRECT_URL`), `npx prisma migrate reset --force --skip-seed`, `npm run seed`, `PORT=<porta> npx tsx src/server.ts` e `npx --yes newman run ../testes/api/postman/Baluarte-N2AT1.postman_collection.json --env-var baseUrl=http://localhost:<porta>`.
- **Número atual (medido em 14/10/2026, porta 8120):** 35 requisições, 70 asserções, 0 falhas.

## 6. Testes de frontend (Vitest)

- **O que verifica:** componentes, páginas, hooks, adaptadores da API, camada mock e acessibilidade (axe) do frontend do produto (o teste de XSS da seção 4.2 é entregue pela sessão Frontend).
- **Onde:** `baluarte-frontend/src/__tests__/`.
- **Como rodar:** `cd baluarte-frontend && npm test`; cobertura com `npm run test:coverage` (falha abaixo de 80% de linhas, 75% de ramos e 70% de funções).
- **Número atual (medido em 13/10/2026):** 642 testes com os 4 de XSS da sessão Frontend aplicados (sem eles, 638 naquela base; 647 na `main` `84cacd1`). Seis execuções seguidas: cinco verdes e uma com 1 falha intermitente que não se repetiu (ver "Lacunas"). Cobertura: 93,3% de linhas, 86,0% de ramos, 85,9% de funções.

## 7. Funcional com Playwright, modo mock

- **O que verifica:** os fluxos das telas do produto no Chrome, desktop e mobile, sobre a camada mock: login, RBAC por perfil, vulnerabilidades, campanhas, usuários, configurações, treinamento, estações, análise de arquivos, anexo de campanha, aviso de monitoramento e layout responsivo.
- **Onde:** `baluarte-frontend/e2e/*.spec.ts`.
- **Como rodar:** `cd baluarte-frontend && E2E_PORT=<porta livre> npm run test:e2e` (o Playwright sobe um Vite próprio nessa porta).
- **Número atual (medido em 13/10/2026, porta 5213):** 46 aprovados, 14 pulados (capturas de referência, só com `E2E_SCREENSHOTS=1`).

## 8. Funcional com Playwright, modo real

- **O que verifica:** os mesmos fluxos contra a API real e o PostgreSQL: conta e operação (convite e redefinição pelo Mailpit, troca de senha, conta inativada, "Risco aceito", campanha), aviso de monitoramento, anexo de campanha, análise de arquivos com ClamAV e estações com agente osquery simulado e OSV/NVD falsos.
- **Onde:** `baluarte-frontend/e2e/real/`; orquestrador `scripts/e2e-real.mjs` (sobe e derruba banco descartável, bases falsas, API, Vite e Mailpit).
- **Como rodar:** `E2E_DB_NAME=baluarte_e2e_<prefixo> E2E_API_PORT=<p1> E2E_WEB_PORT=<p2> E2E_BASES_PORT=<p3> node scripts/e2e-real.mjs`; `E2E_CLAMAV=1` exige o ClamAV.
- **Número atual (medido em 13/10/2026, sem ClamAV):** 21 testes: 14 aprovados, **2 falharam**, 5 pulados (os que dependem do ClamAV). As duas falhas estão em `e2e/real/estacoes.spec.ts` e não vêm desta revisão (nenhum arquivo de `src/` mudou): o spec e as bases falsas (`scripts/e2e/bases-falsas.mjs`) não acompanharam o DT17 de 11/10/2026. A base falsa não publica versão corrigida, então os 2 CVEs esperados contam como "sem correção publicada" e não viram achado; e, com a base fora do ar, a tela agora diz "Verificação incompleta: nada foi registrado" em vez de "0 achados novos". A regra do DT17 está certa; o teste ficou desatualizado.

## 9. Robot Framework da N2 AT1

- **O que verifica:** as 6 suítes de interface da N2 AT1 (cadastro de usuário, campanha, login, alteração e redefinição de senha, cadastro de ativo) com Selenium, contra o frontend legado (`frontend/`, porta 3000).
- **Onde:** `e2e/*.robot`.
- **Como rodar:** com backend e `frontend/` no ar e banco limpo, `python -m robot --outputdir e2e/resultados e2e/*.robot`.
- **Número atual (última medição registrada: 08/10/2026, CHANGELOG do B09):** 29 testes, 29 aprovados. Não repetido nesta revisão.

## 10. Carga da API

- **O que verifica:** o RNF-004 (dashboard com p90 ≤ 3 s para 200 usuários simultâneos; relatório em até 60 s) e a US-003 (página da lista em até 3 s), com autocannon 8.0.0 numa instância isolada (porta 8100, banco `baluarte_carga*` com 1.208 achados).
- **Onde:** `backend/scripts/carga.mjs`; relatório em `testes/carga/RELATORIO.md`.
- **Como rodar:** `cd backend && npm run carga` (cerca de 4 min).
- **Número atual (última medição: 10/10/2026):** dashboard p90 1.404 ms com 200 conexões; lista paginada p90 484 ms; ativos p90 333 ms; PDF com 1.208 achados p95 7.140 ms; todos dentro da meta, sem resposta fora de 2xx.

## 11. Análise estática com SonarQube

- **O que verifica:** o RNF-008 (cobertura ≥ 70% e nenhum issue crítico): bugs, vulnerabilidades, hotspots, code smells e duplicação, com SonarQube Community e sonar-scanner em contêineres de versão fixa.
- **Onde:** `scripts/sonarqube.mjs`; relatório em `testes/qualidade/sonarqube.md`.
- **Como rodar:** gerar a cobertura (`npm run cobertura` no backend, `npm run test:coverage` no frontend) e depois `node scripts/sonarqube.mjs`.
- **Número atual (última medição: 08/10/2026, base `d89cc3f`):** 0 bugs nos dois projetos; 0 vulnerabilidades no backend e 6 no frontend, todas na camada mock (fora do build de produção); issues CRITICAL/BLOCKER de manutenibilidade: 5 no backend e 22 no frontend. O "zero issues críticos" do RNF-008 não é atendido ao pé da letra.

## 12. Navegadores (RNF-007)

- **O que verifica:** a suíte mock do Playwright no Firefox e no WebKit do Playwright e no Microsoft Edge da máquina, em 1366×768.
- **Onde:** `baluarte-frontend/scripts/e2e-navegadores.mjs` (Vite próprio na 5202).
- **Como rodar:** `cd baluarte-frontend && npm run test:e2e:navegadores:instalar` (uma vez, depois de cada `npm ci`) e `npm run test:e2e:navegadores`.
- **Número atual (última medição: 08/10/2026, CHANGELOG do B30):** 126 testes (42 de desktop × 3 navegadores), 126 aprovados. Não repetido nesta revisão.

## 13. Validação do agente em contêiner

- **O que verifica:** o instalador `agente/instalar-agente.sh` com o `.deb` oficial do osquery 5.23.1 e o `osqueryd` de verdade num Ubuntu 24.04, falando com a API pelo HTTPS do B06, numa rede sem internet com OSV/NVD simulados: inscrição, inventário, segundo ciclo sem duplicar e a verificação de vulnerabilidades.
- **Onde:** `scripts/validar-agente-docker.sh` e `scripts/validacao-agente/`.
- **Como rodar:** `sh scripts/validar-agente-docker.sh` (Git Bash; cerca de 5 min na primeira vez).
- **Número atual (última medição: 08/10/2026, CHANGELOG do B08):** inscrição, inventário de 93 pacotes com SO e portas, `GET /api/estacoes`, segundo ciclo sem duplicar e um achado da vulnerabilidade fictícia `CVE-2099-0001`, que não se repete na segunda verificação. Não repetido nesta revisão.

## 14. Auditoria de dependências (`npm audit`)

- **O que verifica:** vulnerabilidades conhecidas nas dependências diretas e transitivas, pelo banco de avisos do registro npm.
- **Onde:** `backend/package-lock.json` e `baluarte-frontend/package-lock.json` (e, só para registro, `frontend/package-lock.json`).
- **Como rodar:** `npm audit` em cada pasta; `npm audit --omit=dev` mostra só o que vai para produção.
- **Número atual (medido em 13/10/2026):**
  - **Backend:** 0 vulnerabilidades, com e sem as dependências de desenvolvimento.
  - **Frontend do produto (a correção é da sessão Frontend):** 18 (7 moderadas, 8 altas, 3 críticas); em produção (`--omit=dev`), **2 moderadas**, ambas do `react-router`. Conferido em 14/10/2026 sobre o lockfile da `main`. `npm audit fix`, sem `--force`, corrige as que não exigem troca de versão maior: `brace-expansion` (1.1.18 → 1.1.21, 2.1.4 → 2.1.7, 5.0.9 → 5.0.12) e `source-map-js` (1.2.1 → 1.2.2), só no `package-lock.json`, deixando 16 (7 moderadas, 6 altas, 3 críticas). Essa mudança do lockfile sai pela sessão Frontend, não pela branch do backend.
  - **Frontend legado (`frontend/`, só leitura do lockfile):** 16 (6 moderadas, 10 altas), 2 moderadas em produção (`react-router`). Não corrigido: ver "Lacunas".

O que ficou no frontend do produto, com justificativa:

- **`react-router` e `react-router-dom` 6.30.x (moderada, vai para produção).** Dois avisos. GHSA-wrjc-x8rr-h8h6: open redirect por barra invertida em `<Link>` e `useNavigate`. O único redirecionamento com destino vindo de fora é o do login, e `src/lib/redirect.ts` (DT02) só aceita caminho que começa com uma barra, não começa com `//` ou `/\` e não contém barra invertida em lugar nenhum; o resto da navegação usa caminhos fixos do código. GHSA-337j-9hxr-rhxg: injeção de construtor em `deserializeErrors()` na hidratação de SSR; o Baluarte é SPA sem SSR, então não se aplica. A correção só existe no `react-router-dom` 7.18.4 (versão maior, migração das rotas): pendência.
- **`vitest`, `@vitest/coverage-v8`, `@vitest/mocker`, `vite-node` e `tinypool` (críticas e moderadas, só de desenvolvimento).** O executor de testes, que roda código do próprio repositório e não entra no build. Correção: `vitest` 5 (versão maior).
- **`vite` e `esbuild` (alta e moderada, só de desenvolvimento).** O aviso do `esbuild` é sobre o servidor de desenvolvimento responder a qualquer site; o build de produção é estático e servido pelo Nginx ou pela CDN. Correção: `vite` 8 (versão maior).
- **`tailwindcss`, `braces`, `chokidar`, `micromatch`, `fast-glob`, `postcss-nested` e `postcss-selector-parser` (altas e moderadas, só de build).** Negação de serviço por padrões de glob ou seletores maliciosos; a entrada é o próprio código-fonte. Correção: `tailwindcss` 4 (versão maior, configuração reescrita).

## Lacunas conhecidas

- **Duas falhas no Playwright real** (seção 8), herdadas do DT17: o spec `estacoes.spec.ts` e as bases falsas precisam publicar versão corrigida e esperar a mensagem de verificação incompleta. A suíte real não é verde na `main` desde 11/10/2026, e nenhum processo automático acusou isso.
- **Falha intermitente no Vitest:** 1 falha em 1 de 6 execuções completas, sem repetição nas 5 seguintes e sem o nome do teste guardado (a saída daquela execução não foi preservada). Precisa de investigação com `--reporter=verbose` em laço.
- **Métodos não repetidos nesta revisão:** Robot, carga, SonarQube, navegadores e validação do agente trazem a última medição registrada (08 a 10/10/2026). Depois delas entraram o índice de risco em curva de saturação, a trava da auditoria no banco e o fechamento automático dos achados de estação. O CLAUDE.md pede uma nova rodada de carga a cada leitura nova no dashboard, e o SonarQube foi feito sobre uma base anterior a vários PRs. Os números dessas seções valem como histórico, não como estado atual.
- **Robot depende da porta 8080 e do frontend legado na 3000:** não roda isolado como Newman e Playwright, por isso não foi repetido aqui.
- **ClamAV real fora desta medição:** os 5 testes reais de arquivos ficaram pulados; a cobertura do antivírus nesta revisão é a do clamd falso da integração.
- **Sem integração contínua:** o repositório não tem `.github/workflows`; todas as suítes rodam à mão. Uma regressão como a do Playwright real (primeiro item) só aparece quando alguém roda a suíte certa.
- **SonarQube não atende o RNF-008 ao pé da letra** (seção 11): issues de manutenibilidade CRITICAL/BLOCKER continuam abertos.
- **Dependências com correção só em versão maior** (seção 14): o `react-router` vai para produção; os demais são de desenvolvimento ou de build.
- **Frontend legado sem `npm audit fix`:** o lockfile de `frontend/` tem correções sem troca de versão maior, mas ele é o alvo congelado das suítes Robot, e mudar as dependências sem rodar o Robot seria mudar a N2 AT1 às cegas.
- **XSS só no escopo do React:** o teste do frontend (entregue pela sessão Frontend) cobre ativos e vulnerabilidades (os campos pedidos no cartão) e um grep do código inteiro; as demais telas confiam no mesmo escape do React, sem teste de payload próprio.
- **Parser de XML presente no backend (seção 4.3):** o `saxes` vem com o `exceljs` e hoje é inalcançável porque o Baluarte só escreve planilhas. Importar planilha (ler XLSX enviado) torna o XXE aplicável: o teste de `superficie-nao-aplicavel.test.ts` falha nesse dia e a leitura precisa de teste de XXE próprio.
- **Pentest automatizado não substitui um pentest externo:** os testes atacam o que a equipe pensou em atacar; não há DAST (como o ZAP) contra a stack nem revisão por terceiros.
