# Limites do clamd: roteiro de conferência (Melhorias #18)

O arquivo pode ter até 250 MB, e o clamd só dá um veredito válido se ler o arquivo **inteiro**.
O risco: com o `StreamMaxLength` padrão, a cauda de um arquivo grande não é lida. Este roteiro
confere três coisas: (1) os `CLAMD_CONF_*` do `docker-compose.yml` chegam ao clamd.conf que o
clamd realmente lê, apesar do `entrypoint:` próprio do serviço `clamav` (o que copia as regras
YARA); (2) arquivo simples com o marcador nos últimos bytes sai AMEAÇA; (3) estouro do limite
nunca sai LIMPO.

## 1. Na VM, depois do release

```sh
docker compose -f docker-compose.yml -f docker-compose.servidor.yml --profile antivirus up -d --force-recreate clamav
# espere o "socket found, clamd started." no log
docker compose -f docker-compose.yml -f docker-compose.servidor.yml --profile antivirus logs clamav | grep -E "Regras YARA|Global (time|size) limit|File size limit|MaxHTMLNormalize|MaxScriptNormalize|PCREMaxFileSize|exceed set maximums|clamd started"
docker compose -f docker-compose.yml -f docker-compose.servidor.yml --profile antivirus exec clamav sh -c 'grep -E "^(StreamMaxLength|MaxFileSize|MaxScanSize|MaxScanTime|AlertExceedsMax|MaxHTMLNormalize|MaxScriptNormalize|PCREMaxFileSize)" /etc/clamav/clamd.conf'
docker compose -f docker-compose.yml -f docker-compose.servidor.yml --profile antivirus exec clamav sh -c 'ps -o pid,args | grep "[c]lamd"; clamconf | grep -E "^Config file: clamd.conf|StreamMaxLength"'
```

Saída esperada do `grep` (medida em 19/10/2026, ClamAV 1.5, projeto isolado `m18c`):

```
StreamMaxLength 251M
MaxScanTime 240000
MaxScanSize 1000M
MaxFileSize 1001M
MaxHTMLNormalize 1001M
MaxScriptNormalize 1001M
PCREMaxFileSize 1001M
AlertExceedsMax yes
```

O `clamd` roda como `clamd --foreground`, sem `-c`, então lê o `/etc/clamav/clamd.conf` padrão,
o mesmo do `grep`; o `clamconf` confirma `StreamMaxLength = "263192576"` (251 MiB). O log da
subida mostra os mesmos números:

```
Regras YARA do Baluarte: 4
Limits: Global time limit set to 240000 milliseconds.
Limits: Global size limit set to 1048576000 bytes.
Limits: File size limit set to 1049624576 bytes.
Limits: MaxHTMLNormalize limit set to 1049624576 bytes.
Limits: MaxScriptNormalize limit set to 1049624576 bytes.
Limits: PCREMaxFileSize limit set to 1049624576 bytes.
Heuristic alerting enabled for scans that exceed set maximums.
socket found, clamd started.
```

O log **não** imprime o `StreamMaxLength`; por isso o `grep` no clamd.conf e o `clamconf`.

Sinal de que a configuração NÃO entrou (é o estado da `main` antes do #18): o `grep` não devolve
nada (no arquivo só existe o comentário `#StreamMaxLength 25M` do exemplo), e o log diz
`Global time limit set to 120000`, `Global size limit set to 419430400`, `File size limit set to
104857600` e `AlertExceedsMax heuristic detection disabled`. Nesse estado o limite efetivo do
fluxo é o padrão compilado de 100 MB, não os 25 MB do comentário: 30 MB passam, 200 MB não
(tabela abaixo).

Mudou um `CLAMD_CONF_*`: `up -d --force-recreate clamav` (o `restart` não relê o ambiente).

## 2. Teste de aceitação contra o clamd real

`backend/tests/aceitacao-clamd-real.test.ts` só roda com `CLAMAV_HOST` (sem ele, fica *skipped* e
não cria banco). Arquivos simples, sem compactação, gerados em fluxo, com o marcador YARA
inofensivo do Baluarte (`antivirus/regras/baluarte_teste.yar`, montado em memória a partir de
partes; nunca o EICAR, nunca em disco) nos últimos bytes, enviados pela rota
`POST /arquivos/analise` da API. Aprovado = 201 AMEAÇA `YARA.BaluarteMarcadorTeste.UNOFFICIAL`.
Tem também um controle de 30 MB sem o marcador, que precisa sair LIMPO.

Na estação, com um clamd isolado (projeto `m18c`, sem a porta 3310 nem o volume do projeto
`baluarte`; o volume de assinaturas foi copiado de um volume existente, montado só leitura):

```sh
# override de portas (fora do repositório): ports: !override ["127.0.0.1:13127:3310"]
docker compose -p m18c -f docker-compose.yml -f m18c-portas.yml --profile antivirus up -d --no-deps clamav
cd backend
CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13127 TEST_DB_PREFIXO=m18c_ node --import tsx --test tests/aceitacao-clamd-real.test.ts
```

Para o "antes", o mesmo comando com o `docker-compose.yml` da `main` (`git show
origin/main:docker-compose.yml`), que não tem os `CLAMD_CONF_*`.

Resultado medido em 19/10/2026 (ClamAV 1.5, daily 28157, regras do Baluarte carregadas):

| Arquivo | `main` (sem `CLAMD_CONF_*`) | #18 (com `CLAMD_CONF_*`) |
|---|---|---|
| 30 MB sem marcador (controle) | 201 LIMPO (1,7 s) | 201 LIMPO (4,0 s) |
| 30 MB, marcador nos últimos bytes | 201 AMEAÇA (1,7 s) | 201 AMEAÇA (1,6 s) |
| 200 MB, marcador nos últimos bytes | **503 ANTIVIRUS_INDISPONIVEL** (0,7 s; clamd: `INSTREAM: Size limit reached`) | 201 AMEAÇA (11,2 s; 16,9 s na repetição) |

Na `main`, o arquivo de 200 MB não chega a ser analisado, mas também não sai LIMPO: o clamd
recusa no meio do envio e a API responde 503 (item 3).

## 3. Estouro do `StreamMaxLength` nunca é LIMPO

Quando o fluxo passa do limite, o clamd responde `INSTREAM size limit exceeded. ERROR` antes do
fim do envio e fecha a conexão. O cliente (`backend/src/config/antivirus.ts`) trata resposta antes
do bloco final, conexão encerrada no meio e qualquer resposta fora de `stream: OK` /
`stream: <nome> FOUND` como `AntivirusIndisponivel`, e a rota responde
`503 ANTIVIRUS_INDISPONIVEL`, sem registro. Testes com o clamd falso:

- `tests/analise-arquivo.test.ts`, "clamd que passa do StreamMaxLength": recusa no meio do envio,
  fechando com FIN e derrubando a conexão. Os dois saem 503 e nenhum `FileScan` é gravado.
- `tests/unidade/antivirus.test.ts`: recusa só no fim (`erro do clamd vira AntivirusIndisponivel`)
  e `lerVeredito('INSTREAM size limit exceeded. ERROR')`.
- `tests/unidade/config-clamd.test.ts`: `StreamMaxLength` acima do limite da API no compose.
