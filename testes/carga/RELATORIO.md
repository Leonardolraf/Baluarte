# Teste de carga da API — RNF-004 (B30)

Gerado por `npm run carga` (`backend/scripts/carga.mjs`) em 2026-10-10T05:02:02.189Z. **Não edite à mão:** rode de novo.

## O que o RNF-004 pede

DRS v4: "Relatórios de varredura em até 60s para até 50 endpoints. Dashboard em até 3s para até 200 usuários simultâneos." Critério: **P90 do dashboard ≤ 3 s** com 200 usuários e **relatório ≤ 60 s em 95% das execuções**. A US-003 (cenário 3) pede ainda que **cada página** da lista de vulnerabilidades carregue em até 3 s.

## Como foi medido

- **Instância isolada:** banco descartável `baluarte_carga` no Postgres local (migrations + `seed` + `seed:demo` + `seed:carga`: 1.208 achados em 25 ativos), API em `:8100` com `NODE_ENV=production`, um processo Node. Nada de produção (Vercel/Supabase), da `8080` ou do banco `baluarte`. No fim, a API é parada e o banco apagado.
- **Ferramenta:** autocannon 8.0.0 (versão fixa em `backend/package.json`). Cada cenário dura 30 s depois de 3 s de aquecimento fora da medição; a latência de **cada** resposta é registrada para calcular p50/p90/p95/p99. "Sozinha" é a mediana de 5 requisições em sequência, sem carga. Entre um cenário e outro, o script espera a API esvaziar a fila (a rota voltar ao tempo de repouso), para um cenário não medir a sobra do anterior. "200 usuários simultâneos" = 200 conexões HTTP mantendo uma requisição em voo o tempo todo, sem pausa entre elas (mais duro que 200 pessoas, que leem a tela entre um clique e outro).
- **O que entra no tempo:** a resposta da API, que é a parte que cresce com a carga. A tela soma o JavaScript e o CSS, servidos pelo Nginx (Docker) ou pela CDN (Vercel) sem passar pela API: o dashboard faz uma requisição só à API (`GET /api/dashboard`).
- **Sessões:** os tokens de Administrador, Analista e de um segundo Analista se revezam entre as requisições (o dashboard desses perfis é o mais pesado: o do Colaborador não calcula os indicadores técnicos).
- **Máquina:** AMD Ryzen 7 5700X 8-Core Processor (16 núcleos lógicos), 48 GiB, Windows_NT 10.0.26200, Node v24.16.0, banco postgres:16-alpine. Gerador de carga, API e banco dividem a mesma máquina, então os números são conservadores para a API e não valem como medida da demo pública.

## Resultados

| Cenário | Sozinha | Conexões | Requisições | Req/s | p50 | p90 | p95 | p99 | máx. | não 2xx | erros / timeouts | Meta | Resultado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Dashboard (`GET /api/dashboard`) | 38 ms | 200 | 4.400 | 146,7 | 1.331 ms | 1.404 ms | 1.427 ms | 1.480 ms | 1.582 ms | 0 | 0 / 0 | p90 ≤ 3 s (RNF-004) | **atende** |
| Vulnerabilidades paginadas (`GET /api/vulnerabilidades?pagina=1..61&tamanho=20`) | 13 ms | 200 | 13.391 | 446,4 | 445 ms | 484 ms | 495 ms | 530 ms | 558 ms | 0 | 0 / 0 | p90 ≤ 3 s (US-003 / RNF-004) | **atende** |
| Ativos com nota de risco (`GET /api/assets`) | 11 ms | 200 | 19.448 | 648,3 | 300 ms | 333 ms | 353 ms | 402 ms | 422 ms | 0 | 0 / 0 | p90 ≤ 3 s (mesma régua do dashboard) | **atende** |
| Relatório de vulnerabilidades em PDF, 1.208 achados (`GET /api/vulnerabilidades/relatorio.pdf`) | 753 ms | 10 | 40 | 1,3 | 6.451 ms | 7.132 ms | 7.140 ms | 7.146 ms | 7.146 ms | 0 | 0 / 0 | p95 ≤ 60 s (RNF-004) | **atende** |
| Login com senha certa (`POST /api/login`, bcrypt custo 10) | 73 ms | 50 | 460 | 15,3 | 3.081 ms | 3.351 ms | 3.459 ms | 3.710 ms | 3.963 ms | 0 | 0 / 0 | sem meta no DRS | **informativo** |

### Antes e depois das correções do dashboard (B30)

A rodada de referência, sobre o código da `main` sem o B30 (`4f6faf7`, já com a evolução de 30 dias do B25b; mesmo script e mesma massa, em 2026-10-09T00:54:38.111Z), reprova o dashboard. Três causas, corrigidas no B30 com o mesmo resultado: (1) `GET /dashboard` trazia **todos** os achados do banco (com ativo e remediação) a cada leitura e agregava em memória; agora conta por severidade e críticos no banco e traz só os 5 mais recentes (`panoramaAbertos`); (2) a evolução de 30 dias buscava o último evento de cada achado em cada dia (~30 × achados buscas no índice, e o custo estimado ainda ligava o JIT do Postgres a cada leitura); agora lê o histórico como trechos de status, numa passada (`abertosPorDia`); (3) a janela de 30 dias montava dezenas de `Intl.DateTimeFormat` por leitura, na mesma thread da API; agora um por fuso (`evolucaoRisco.service.ts`). As duas consultas ficam em `backend/src/repositories/vulnerabilidade.repository.ts`; `backend/tests/dashboard.test.ts` confere as duas contra a regra antiga e passa também no código anterior. A rodada de referência fica em `testes/carga/resultados-antes-b30.json`.

| Cenário | Req/s | p50 | p90 | p99 |
|---|---:|---:|---:|---:|
| Dashboard (`GET /api/dashboard`) | 20 → 146,7 | 8.621 ms → 1.331 ms | 8.752 ms → 1.404 ms | 10.069 ms → 1.480 ms |
| Vulnerabilidades paginadas (`GET /api/vulnerabilidades?pagina=1..61&tamanho=20`) | 498,4 → 446,4 | 398 ms → 445 ms | 424 ms → 484 ms | 446 ms → 530 ms |
| Ativos com nota de risco (`GET /api/assets`) | 709,3 → 648,3 | 278 ms → 300 ms | 303 ms → 333 ms | 367 ms → 402 ms |
| Relatório de vulnerabilidades em PDF, 1.208 achados (`GET /api/vulnerabilidades/relatorio.pdf`) | 1,7 → 1,3 | 5.926 ms → 6.451 ms | 6.072 ms → 7.132 ms | 6.083 ms → 7.146 ms |
| Login com senha certa (`POST /api/login`, bcrypt custo 10) | 15,7 → 15,3 | 3.027 ms → 3.081 ms | 3.179 ms → 3.351 ms | 3.957 ms → 3.710 ms |

### Limite de tentativas de login

O limite é **por e-mail** (5 falhas em 15 min, tabela `LoginFailure`) e conta só falhas: login com a senha certa nunca bate nele. O cenário de login acima reveza 206 contas válidas da massa de demonstração e recebeu 0 respostas 429. Para exercitar o limite, 20 tentativas com senha errada foram disparadas **ao mesmo tempo** para `ana.souza@empresa.com` (326 ms ao todo): 5 × 401, 15 × 429. Logo depois, a senha **certa** recebeu `429 MUITAS_TENTATIVAS`.

O limite segura a rajada: 5 senhas erradas avaliadas (401) e 15 recusadas com 429, sem chegar ao bcrypt. A primeira rodada do B30 mostrou 20 × 401 (a contagem vinha antes do bcrypt e o registro da falha depois, sem atomicidade); o DT09 corrigiu reservando a vaga por e-mail antes do bcrypt (`repositories/auth.repository.ts#reservar`, teste em `tests/seguranca/limite-rajada.test.ts`). Com o e-mail bloqueado, nem a senha certa entra até a janela de 15 min passar (comportamento esperado da política).

## Leitura

- **Dashboard (`GET /api/dashboard`):** 4.400 requisições em 30 s (146,7/s), sem nenhuma resposta fora de 2xx; p90 de 1.404 ms. Atende com folga de 2,1× sobre a meta.
- **Vulnerabilidades paginadas (`GET /api/vulnerabilidades?pagina=1..61&tamanho=20`):** 13.391 requisições em 30 s (446,4/s), sem nenhuma resposta fora de 2xx; p90 de 484 ms. Atende com folga de 6,2× sobre a meta.
- **Ativos com nota de risco (`GET /api/assets`):** 19.448 requisições em 30 s (648,3/s), sem nenhuma resposta fora de 2xx; p90 de 333 ms. Atende com folga de 9,0× sobre a meta.
- **Relatório de vulnerabilidades em PDF, 1.208 achados (`GET /api/vulnerabilidades/relatorio.pdf`):** 40 requisições em 30 s (1,3/s), sem nenhuma resposta fora de 2xx; p95 de 7.140 ms. Atende com folga de 8,4× sobre a meta. O PDF é o relatório com todos os achados do filtro, gerado em memória; a varredura simulada conclui em 20 s por construção (`cicloVarredura.service.ts`), então o relatório de uma varredura nova fica pronto em cerca de 20 s mais este tempo. Medido com 10 conexões: exportar o PDF é ação de quem opera, não de 200 pessoas ao mesmo tempo.
- **Login com senha certa (`POST /api/login`, bcrypt custo 10):** 460 requisições em 30 s (15,3/s), sem nenhuma resposta fora de 2xx; p90 de 3.351 ms. O bcrypt (custo 10, `bcryptjs` em JavaScript puro) gasta CPU de propósito e roda na mesma thread da API: o login é a rota mais cara (cerca de 73 ms sozinho, ~15 por segundo no máximo), e uma rajada de logins atrasa as outras rotas enquanto dura. O DRS não dá meta para o login; com 50 logins simultâneos a resposta passa de 3 s.

## Como repetir

```bash
docker compose up -d db          # só o Postgres local (se ainda não estiver no ar)
cd backend && npm run carga      # ~4 min: prepara o banco, mede, escreve este arquivo e limpa tudo
```

Variáveis: `CARGA_CONEXOES` (200), `CARGA_DURACAO` (30 s por cenário), `CARGA_CONEXOES_LOGIN` (50), `CARGA_API_PORT` (8100), `CARGA_DB_NAME` (`baluarte_carga`, precisa começar com `baluarte_carga`), `CARGA_KEEP_DB=1` (mantém o banco). Os números brutos ficam em `testes/carga/resultados.json`; o log da API em `%TEMP%/baluarte-carga/api.log`.
