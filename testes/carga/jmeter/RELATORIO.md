# Teste de carga da API no Apache JMeter — RNF-004

Gerado por `npm run carga:jmeter` (`backend/scripts/carga.mjs --jmeter`) em 2026-11-24T19:18:14.814Z. **Não edite à mão:** rode de novo.

## O que foi rodado

- **Ferramenta:** Apache JMeter 5.6.3, modo sem interface (`jmeter -n -t baluarte-carga.jmx -l resultados.jtl -e -o relatorio-html`), Java da máquina (java version "25.0.2" 2026-01-20 LTS).
- **Plano:** [`baluarte-carga.jmx`](baluarte-carga.jmx). Um grupo de preparação faz **login real** de três contas (Administrador, Analista e um segundo Analista), **extrai o token** da resposta (`JSON Extractor` em `$.dados.token`) e o guarda numa propriedade; os grupos de carga mandam `Authorization: Bearer <token>` revezando as três sessões. O número de páginas da lista também é extraído da resposta (`$.resumo.total`). Os grupos rodam em sequência, cada cenário depois de 3 s de aquecimento fora da medição.
- **Cenários:** dashboard, vulnerabilidades paginadas (todas as páginas em rodízio) e ativos com **200 usuários simultâneos** cada (30 s, sem pausa entre requisições: cada usuário virtual mantém uma requisição em voo o tempo todo); PDF do relatório com 1 usuário (vaga única, DT36) e 3 pedidos simultâneos do PDF para conferir essa vaga; login com senha certa com 50; e 20 senhas erradas **simultâneas** (Synchronizing Timer) para o mesmo e-mail, seguidas da senha certa.
- **Asserções:** status 200 em todos os cenários; resposta do PDF começando com `%PDF-`; tempo por resposta (Duration Assertion) de 3 s no dashboard e na lista e de 60 s no PDF. A meta do RNF-004 é sobre o **percentil**, não sobre cada resposta: a coluna "acima do tempo" conta as respostas isoladas que passaram do limite, e o veredito usa o percentil.
- **Ambiente:** o mesmo do `npm run carga`: banco descartável `baluarte_carga` no Postgres local (migrations + `seed` + `seed:demo` + `seed:carga`), API em `127.0.0.1:8100` com `NODE_ENV=production`, um processo Node; no fim, a API é parada e o banco apagado. O host do plano é fixo em `127.0.0.1`: nada de VM, Vercel ou Supabase.
- **Máquina:** AMD Ryzen 7 5700X 8-Core Processor (16 núcleos lógicos), 48 GiB, Windows_NT 10.0.26300, Node v24.22.1, banco postgres:16-alpine. JMeter, API e banco dividem a mesma máquina (o JMeter, em Java, disputa CPU com a API): os números são conservadores para a API e não valem como medida da demonstração pública.
- **Duração total do plano:** 222 s.
- **Limitação:** o JMeter 5.6.3 traz o Groovy 3.0.20, que não roda no Java 25 ("Unsupported class file major version 69"). Por isso o plano não tem nenhum script (JSR223): só elementos nativos e as funções `__P`, `__setProperty`, `__jexl3`, `__counter`, `__threadNum` e `__logn`.

## Resultados

Percentis calculados aqui sobre **todas as respostas 2xx** do `resultados.jtl`, pelo mesmo método do `npm run carga` (posto mais próximo); as respostas fora de 2xx são contadas à parte e reprovam o cenário, para uma recusa rápida (429) nunca contar a favor da meta. O relatório HTML do JMeter (`relatorio-html/index.html`) mostra as mesmas amostras com o estimador dele (interpolado), e pode diferir em poucos milissegundos.

| Cenário | Usuários | Requisições | Req/s | p50 | p90 | p95 | p99 | máx. | não 2xx | erros de conexão | acima do tempo | Meta | Resultado |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Dashboard (`GET /api/dashboard`) | 200 | 5.799 | 189 | 1.052 ms | 1.083 ms | 1.100 ms | 1.148 ms | 1.286 ms | 0 | 0 | 0 | p90 ≤ 3 s (RNF-004) | **atende** |
| Vulnerabilidades paginadas (`GET /api/vulnerabilidades?pagina=…&tamanho=20`) | 200 | 17.517 | 578,9 | 338 ms | 374 ms | 384 ms | 414 ms | 498 ms | 0 | 0 | 0 | p90 ≤ 3 s (US-003 / RNF-004) | **atende** |
| Ativos com nota de risco (`GET /api/assets`) | 200 | 24.738 | 819,8 | 239 ms | 265 ms | 272 ms | 285 ms | 367 ms | 0 | 0 | 0 | p90 ≤ 3 s (mesma régua do dashboard) | **atende** |
| Relatório de vulnerabilidades em PDF (`GET /api/vulnerabilidades/relatorio.pdf`) | 1 | 55 | 1,8 | 550 ms | 563 ms | 563 ms | 571 ms | 571 ms | 0 | 0 | 0 | p95 ≤ 60 s (RNF-004) | **atende** |
| Login com senha certa (`POST /api/login`, bcrypt custo 10) | 50 | 550 | 17,3 | 2.874 ms | 3.138 ms | 3.288 ms | 3.642 ms | 4.126 ms | 0 | 0 | — | sem meta no DRS | **informativo** |

### Exportações simultâneas do relatório (vaga única, DT36)

3 pedidos do PDF disparados ao mesmo tempo: 1 × 200 com PDF e 2 × 429 `EXPORTACAO_EM_ANDAMENTO`. Esperado (DT36, vaga única): exatamente 1 PDF e 2 recusas. **Atende.** No plano, 3 usuários virtuais pedem o PDF juntos (Synchronizing Timer) e a asserção só aceita 200 com corpo `%PDF-` ou 429 com `EXPORTACAO_EM_ANDAMENTO`. É por essa regra que o cenário de carga do PDF tem 1 usuário: com vários, quase todas as respostas seriam o 429 rápido.

### Limite de tentativas de login

20 senhas erradas disparadas ao mesmo tempo para `ana.souza@empresa.com` (306 ms ao todo): 5 × 401, 15 × 429. O limite segura a rajada: no máximo 5 avaliadas pela política (5 falhas em 15 min, reserva da vaga antes do bcrypt, DT09). Logo depois, a senha **certa** recebeu `429` (esperado: com o e-mail bloqueado, nem a senha certa entra até a janela passar).

## Arquivos

- [`baluarte-carga.jmx`](baluarte-carga.jmx): o plano (abre na interface do JMeter);
- [`relatorio-html/index.html`](relatorio-html/index.html): relatório do JMeter (aquecimento e preparação filtrados por `relatorio.properties`);
- `resultados.jtl`: todas as amostras, em CSV (fora do git, ~9 MB; refeito a cada rodada);
- [`resultados.json`](resultados.json): os números desta tabela.

## Como repetir

```bash
docker compose up -d db                                      # só o Postgres local
cd backend
JMETER_HOME=/caminho/apache-jmeter-5.6.3 npm run carga:jmeter  # prepara, mede, gera o relatório e limpa tudo
```

Para abrir o plano na interface do JMeter com o ambiente no ar: `npm run carga:ambiente` (mostra as propriedades `-J` a passar; Ctrl+C derruba tudo).
