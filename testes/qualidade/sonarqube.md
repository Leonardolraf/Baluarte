# Análise estática com SonarQube — RNF-008 (B30)

Resultado de `node scripts/sonarqube.mjs` em 08/10/2026 (dados brutos em [`sonarqube.json`](sonarqube.json)). SonarQube Community **26.8.0.126808** (`sonarqube:26.8.0.126808-community`) e sonar-scanner **`sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0`**, os dois em contêiner, numa instância local e temporária: o script sobe o servidor só em `127.0.0.1:9000`, troca a senha do admin por uma aleatória, gera o token de análise na hora (só na memória do processo, nunca em arquivo), analisa os dois projetos com o `sonar-project.properties` de cada pasta e o lcov da cobertura, coleta os números pela API e remove contêineres, volumes e rede.

> **Base da análise:** o código do B30 sobre a main `d89cc3f`. Depois dela o B30 foi rebaseado sobre o B25b, o B18, o B23, o DT09 e os PRs #36, #38 e #39 (main `6586295`), e a análise **não foi refeita**: os números abaixo não cobrem o código que entrou nesses itens. Para medir de novo, siga "Como repetir".

## O que o RNF-008 pede

DRS v4: "Cobertura de testes unitários ≥ 70% e ausência de issues críticos identificados por análise estática", verificado com SonarQube: **cobertura ≥ 70% e zero issues críticos no SonarQube**.

## Resultado

| | Backend (`backend/`) | Frontend do produto (`baluarte-frontend/`) |
|---|---:|---:|
| Linhas de código (ncloc) | 5.103 | 18.045 |
| Quality gate (Sonar way) | **OK** (ver ressalva abaixo) | **OK** (ver ressalva abaixo) |
| Bugs | **0** (confiabilidade A) | **0** (confiabilidade A) |
| Vulnerabilidades | **0** (segurança A) | **6**, todas na camada mock (segurança C) |
| Security hotspots a revisar | 0 | 0 |
| Code smells | 106 (manutenibilidade A) | 234 (manutenibilidade A) |
| Duplicação | 1,4% | 0,8% |
| Cobertura (lcov) | **98,2%** (linhas 99,1%, ramos 94,8%) | **90,9%** (linhas 92,2%, ramos 85,2%) |
| Issues BLOCKER / CRITICAL (severidade clássica) | 0 / 5 | 1 / 21 |
| Issues BLOCKER / HIGH (modelo de impactos) | 0 / 5 | 1 / 26 |

**Cobertura:** atende o RNF-008 com folga nos dois lados (a medida do SonarQube bate com a do c8 e do Vitest: backend 99,1% de linhas na suíte completa; frontend 92,2% / 85,2% / 84,8% de linhas, ramos e funções).

**Ressalva do quality gate:** o portão padrão (Sonar way) avalia só o **código novo**. Numa instância nova não há análise anterior, então não há código novo e o portão passa sem nenhuma condição avaliada. O "OK" não é evidência de qualidade; os números das linhas acima são.

**"Zero issues críticos":** **não atende ao pé da letra.** Bugs e vulnerabilidades críticos: zero nos dois projetos. O que sobra com severidade CRITICAL/HIGH é **manutenibilidade** (complexidade cognitiva acima de 15 e funções aninhadas demais), e há um BLOCKER num script de capturas de tela do Playwright. Detalhe e justificativa abaixo.

## O que a primeira análise achou e foi corrigido no B30

A primeira rodada (mesmo dia, antes das correções) deu backend com **3 bugs e 3 vulnerabilidades** e frontend com **1 bug**. Triagem e correção, sem mudança de comportamento:

| Regra | Onde | Era real? | O que foi feito |
|---|---|---|---|
| `S2871` (bug, CRITICAL): `sort()` sem função de comparação | `services/cruzamento.service.ts` (3) e `mocks/api.ts` (1) | Não: ordena identificadores (pacotes, programas, `OSV`/`NVD`, códigos de ação), e o `sort()` sem argumento já é determinístico por unidade de código | Comparação explícita por unidade de código (`porCodigo`), a mesma ordem de antes; os testes do cruzamento seguem verdes |
| `S2245` (vulnerabilidade, MEDIUM): `Math.random()` | `services/cicloVarredura.service.ts` (2) | Não: sorteia os achados da varredura **simulada**, nada de segredo | `crypto.randomInt`, que tira a dúvida sem custo |
| `S6389` (vulnerabilidade, MEDIUM): caractere bidirecional no fonte | `tests/seguranca/injecao.test.ts` | O caractere é proposital (payload de teste), mas um U+202E literal no fonte é justamente o truque "Trojan Source" | Escrito como escape `‮`: o teste manda o mesmo valor e o fonte não carrega mais o caractere |
| `S2699` (BLOCKER): teste sem asserção | `tests/banco.test.ts`, `tests/unidade/progresso-varredura.test.ts` | Não (o teste falhava pela exceção), mas a intenção ficava implícita | Asserções explícitas (`assert.equal` na contagem, `assert.doesNotThrow`) |

## O que ficou, com justificativa

**Vulnerabilidades do frontend (6, MEDIUM), todas em `src/mocks/`:**
- `S2068` (2) em `mocks/data.ts:135-136`: as credenciais de demonstração da camada mock (`Admin@123`, `Senha@123`), as mesmas publicadas no README. Não são segredos, e a camada mock **não entra no build de produção** (import dinâmico atrás de `VITE_USE_MOCKS`; conferido: nenhuma dessas senhas aparece em `dist/assets/*.js` depois de `npm run build`).
- `S2245` (4) em `mocks/api.ts:247, 254, 448, 450`: `Math.random()` para latência simulada, injeção de falha e sorteio de achados do mock. Sem uso de segurança.

**Severidade CRITICAL/HIGH restante (manutenibilidade):**
- Backend (5): `S3776` complexidade cognitiva em `models/cruzamento.model.ts` (2), `services/cruzamento.service.ts` (2, uma em 45) e `services/agente.service.ts` (1, 17). São a leitura das respostas do OSV/NVD e a montagem dos achados do B14, cobertas por testes de unidade e integração.
- Frontend (21 CRITICAL + 5 só HIGH): `S3776` em 19 funções (telas de lista e detalhe, `services/api.ts`, `components/ui/Table.tsx` e o mock), `S2004` (2, funções aninhadas em `ScanListPage.tsx`), `S7746` (3, `return Promise.reject(error)` nos interceptors do axios em `services/api.ts`) e `S7767` (2, `| 0` no gerador pseudoaleatório determinístico de `mocks/data.ts`).
- Frontend BLOCKER (1): `S2699` em `e2e/screenshots.spec.ts:55`. Não é teste: gera capturas de referência e só roda com `E2E_SCREENSHOTS=1`.

Nenhum desses é defeito ou falha de segurança; são dívida de manutenibilidade (funções grandes demais para ler de uma vez). Refatorar ~25 funções de tela e de cruzamento não cabe no B30 sem risco de regressão; fica registrado como pendência para quem for mexer nesses arquivos (`S3776` acima de 20 primeiro: `cruzamento.service.ts:84` com 45, `FileAnalysisPage.tsx:344` com 35, `AssetListPage.tsx:88` com 27, `TrainingPage.tsx:85` com 26 e `cruzamento.model.ts:57` com 26).

## Como repetir

```bash
docker compose up -d db                                     # Postgres local, para a cobertura do backend
cd backend && TEST_DB_PREFIXO=sonar_ npm run cobertura      # gera coverage/lcov.info (apague os bancos baluarte_test_sonar_* depois)
cd ../baluarte-frontend && npm run test:coverage            # gera coverage/lcov.info
cd .. && node scripts/sonarqube.mjs                         # ~5 min; baixa as imagens na 1ª vez (~1 GB)
```

O script recusa rodar sem os dois `lcov.info`, reescreve os caminhos do lcov para relativos (o scanner roda em Linux, com o projeto em `/usr/src`) e grava `testes/qualidade/sonarqube.json`. Nenhum token ou senha sai do processo: o token vai para o scanner pela variável `SONAR_TOKEN`, herdada do ambiente (não aparece na linha de comando), e morre com o contêiner. A configuração de cada projeto está em `backend/sonar-project.properties` e `baluarte-frontend/sonar-project.properties`.
