# Limites do clamd: roteiro de conferência (Melhorias #18)

O arquivo pode ter até 250 MB, e o clamd só dá um veredito válido se ler o arquivo **inteiro**.
O risco: com o `StreamMaxLength` padrão, a cauda de um arquivo grande não é lida. Este roteiro
confere três coisas: (1) os `CLAMD_CONF_*` do `docker-compose.yml` chegam ao clamd.conf que o
clamd realmente lê, apesar do `entrypoint:` próprio do serviço `clamav` (o que copia as regras
YARA); (2) arquivo simples com o marcador nos últimos bytes sai AMEAÇA; (3) estouro do limite
nunca sai LIMPO. O item 4 é a regressão da imagem para o Zip64 do DT27.

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
Configuracao dinamica do Baluarte: 1
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
fluxo é o padrão compilado de 100 MiB, não os 25 MB do comentário: 30 MB passam, 200 MB não
(tabela abaixo). Medido em 19/10/2026 (DT26) num clamd 1.5.4 isolado (projeto `dt26`) sem os
`CLAMD_CONF_*`: `grep StreamMaxLength /etc/clamav/clamd.conf` devolve só `#StreamMaxLength 25M`
e o `clamconf` diz `StreamMaxLength = "104857600"` (100 MiB); o log da subida, `MaxHTMLNormalize
limit set to 41943040 bytes` (40 MiB) e `MaxScriptNormalize limit set to 20971520 bytes`.

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

A suíte tem também o marcador dentro de HTML e de e-mail com HTML (DT26) e o teste de
comportamento do `MaxHTMLNormalize` (item 5).

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

## 4. Zip64 (DT27): regressão da imagem

O ClamAV 1.5.4 não lê a entrada de zip cujo cabeçalho **local** traz `0xFFFFFFFF` no tamanho
comprimido ou no original **com o bit 3 da flag (descritor de dados) desligado**: o tamanho real
só existe no campo extra Zip64 (0x0001), que ele não lê, e ele responde "OK" sem ter lido
(Cisco-Talos/clamav#1527). É a forma do `zipfile` do Python com `force_zip64` e do 7-Zip lendo da
entrada padrão (`-si`). As outras formas de Zip64 ele lê e varre. O critério (iii) do DT27
(`backend/src/utils/detectorZip64.ts`) só trata como ameaça essa forma
(`Baluarte.Zip64.NaoAnalisavel`); as outras seguem o veredito do clamd. Esse critério depende do
comportamento da imagem, e `backend/tests/regressao-clamd-zip64.test.ts` confere esse
comportamento: só roda com `CLAMAV_HOST`, não usa banco nem a API, e manda as formas **direto ao
clamd** (INSTREAM, pelo cliente `config/antivirus.ts`), montadas em memória por
`tests/zipDeTeste.ts`, com o marcador YARA inofensivo do Baluarte comprimido dentro (nunca o
EICAR, nada em disco). Se a imagem mudar (deixar de ler uma forma, ou passar a ler a forma
`0xFFFFFFFF` sem descritor), o teste falha com "comportamento do ClamAV mudou: rever o critério
do DT27".

Na estação, com um clamd isolado (projeto `dt27c`, sem a porta 3310 nem o volume do projeto
`baluarte`; assinaturas copiadas de um volume existente, montado só leitura):

```sh
# override de portas (fora do repositório): ports: !override ["127.0.0.1:13122:3310"]
docker compose -p dt27c -f docker-compose.yml -f dt27c-portas.yml --profile antivirus up -d --no-deps clamav
cd backend
CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13122 node --import tsx --test tests/regressao-clamd-zip64.test.ts
```

Resultado medido em 19/10/2026 (ClamAV 1.5.4, daily 28157, regras do Baluarte carregadas), 6/6:

| Forma (marcador YARA comprimido dentro) | clamd | Esperado |
|---|---|---|
| zip comum (controle) | `YARA.BaluarteMarcadorTeste.UNOFFICIAL` | detecta |
| Zip64 com tamanhos reais no cabeçalho local e extra 0x0001 (NetBeans) | `YARA.BaluarteMarcadorTeste.UNOFFICIAL` | detecta (lê) |
| Zip64 com `0xFFFFFFFF` no local e descritor de dados Zip64 (Info-ZIP por pipe) | `YARA.BaluarteMarcadorTeste.UNOFFICIAL` | detecta (lê) |
| Zip64 só no diretório central e no registro de fim Zip64 + localizador | `YARA.BaluarteMarcadorTeste.UNOFFICIAL` | detecta (lê) |
| `0xFFFFFFFF` no local, sem descritor, com extra 0x0001 (Python `force_zip64`) | **OK** | não detecta (não lê) |
| a mesma, sem o extra 0x0001 (montada à mão) | **OK** | não detecta (não lê) |

A última linha é o motivo de o detector não exigir o campo extra: sem ele o clamd falha do mesmo
jeito. Medido à parte, fora do teste: com `0xFFFFFFFF` **só** no tamanho original (o comprimido
real), o clamd lê e detecta; o critério aprovado cobre "comprimido **ou** original", então essa
forma (que nenhuma ferramenta conhecida grava sozinha) cai por precaução no detector.

## 5. HTML: o que o YARA vê, e o `MaxHTMLNormalize` (DT26)

**Causa do DT26 (classe, não pontual).** Num arquivo que o ClamAV reconhece como HTML (pelo
conteúdo; vale para a parte HTML de um e-mail, inclusive em base64), ele pula a varredura do
arquivo cru: o submódulo `DOCUMENT/HTMLSKIPRAW` da configuração dinâmica (DCONF) vem ligado por
padrão e o `daily.cfg` não o desliga. As assinaturas, inclusive as regras YARA, só correm sobre as
cópias normalizadas `nocomment.html` (minúsculas, entidades decodificadas, espaços fora do texto
retirados, comentários apagados; limitada pelo `MaxHTMLNormalize`) e `notags.html` (só o texto,
limitada pelo `MaxHTMLNoTags`, 8 MiB), mais a cópia `javascript` dos `<script>`. Evidência com
`clamscan --debug --leave-temps` num contêiner descartável com as mesmas regras: no `.txt` aparece
`Performing raw scan` e o `matcher_run` corre sobre os bytes do arquivo; no `.html` aparece
`in cli_scanhtml()` e o `matcher_run` corre só sobre os 947 e os 721 bytes das duas cópias (o
original tinha 994; "Data scanned 1.63 KiB"), com o marcador escrito
`baluarte-teste-ameaca-0001-arquivo-inofensivo`. O marcador em maiúsculas, sem `nocase`, nunca
casava; em comentário, ele nem chega às cópias. Com `--scan-html=no` o HTML volta a ser varrido cru
e o marcador dispara (mas desligar o ScanHTML tira as 10 mil assinaturas de HTML do banco oficial:
não é conserto).

**Conserto:** `nocase` no marcador e `antivirus/regras/baluarte_html_cru.cfg`
(`DOCUMENT:0xffffffef:0`: todos os submódulos de DOCUMENT ligados, menos o `HTMLSKIPRAW`), copiado
pelo entrypoint. O ClamAV carrega o `daily` (e o `daily.cfg`) antes dos arquivos locais, então a
linha prevalece; o `clamscan --debug` passa a listar `Submodule HTMLSKIPRAW: ** Off **` e os outros
submódulos de DOCUMENT `On`, e o HTML é varrido cru e normalizado. Sem nenhuma das duas peças
(tabela de `clamscan` só com as regras do Baluarte, HTML com o marcador no meio; 1 KB, 100 KB e
1 MiB deram o mesmo resultado):

| Onde está o marcador | `main` | só `nocase` | `nocase` + `.cfg` |
|---|---|---|---|
| `.txt`, `.js`, `.vbs` soltos | AMEAÇA | AMEAÇA | AMEAÇA |
| HTML: texto visível, atributo, `<script>`, `<style>` | LIMPO | AMEAÇA | AMEAÇA |
| HTML: os mesmos com entidades `&#66;` ou `&#x42;` | LIMPO | AMEAÇA | AMEAÇA |
| HTML: comentário | LIMPO | LIMPO | AMEAÇA |
| HTML: comentário com entidades (nenhum leitor decodifica) | LIMPO | LIMPO | LIMPO |
| `.eml` com a parte HTML em texto puro, sem entidades | AMEAÇA | AMEAÇA | AMEAÇA |
| `.eml` com a parte HTML em texto puro, com entidades | LIMPO | AMEAÇA | AMEAÇA |
| `.eml` com a parte HTML em base64: visível, `<script>` | LIMPO | AMEAÇA | AMEAÇA |
| `.eml` com a parte HTML em base64: comentário | LIMPO | LIMPO | AMEAÇA |

O `.eml` em texto puro saía AMEAÇA porque a mensagem inteira é varrida crua antes de o ClamAV
extrair a parte HTML; em base64 o marcador só existe na parte extraída, que é HTML. No clamd de
verdade (projeto isolado `dt26`, assinaturas oficiais, daily 28158) e pela rota da API, a suíte de
aceitação com as regras da `main` deu LIMPO nos 8 casos de HTML e de e-mail; com o conserto, os 8
saem AMEAÇA.

**Teste de comportamento do `MaxHTMLNormalize`** (`tests/aceitacao-clamd-real.test.ts`): um HTML
de 45 MB, gerado em fluxo (sem fixture), com HTML smuggling inofensivo no fim escrito de modo que
só a forma normalizada case a regra `BaluarteHtmlPayloadBase64` (`at&#111;b(` num atributo de
evento, sem `new Blob`; o próprio teste confere que o cru não tem nenhuma string de remontagem). A
varredura crua religada não o acha; quem acha é a normalização. Medido em 19/10/2026:

| Configuração | HTML de 45 MB, smuggling normalizado no fim |
|---|---|
| #18 (`MaxHTMLNormalize 1001M`) | 201 AMEAÇA `YARA.BaluarteHtmlPayloadBase64.UNOFFICIAL` (6,7 s) |
| antiga, sem os `CLAMD_CONF_*` (`MaxHTMLNormalize` 40 MiB) | **201 LIMPO** (6,3 s) |

Na configuração antiga, o mesmo HTML com 30 MB sai AMEAÇA e, com 45 MB, sai LIMPO também com a
amostra no meio do arquivo: acima do limite, o ClamAV não normaliza o HTML, não só a cauda. A forma
crua (`atob(` e `new Blob` legíveis) sai AMEAÇA nas duas configurações, porque a varredura crua a
pega; por isso o teste usa a forma que depende da normalização.

```sh
# configuração antiga: override sem os CLAMD_CONF_* (fora do repositório)
#   services: { clamav: { environment: !reset [] } }
POSTGRES_PASSWORD=x docker compose -p dt26 -f docker-compose.yml -f dt26-portas.yml -f dt26-antiga.yml --profile antivirus up -d --no-deps --force-recreate clamav
docker compose -p dt26 ... exec clamav sh -c 'grep StreamMaxLength /etc/clamav/clamd.conf; clamconf | grep -i StreamMaxLength'
cd backend
CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13126 TEST_DB_PREFIXO=dt26_ node --import tsx --test tests/aceitacao-clamd-real.test.ts
```

Na configuração antiga a suíte falha em dois testes, de propósito: 200 MB (503, `StreamMaxLength`)
e o HTML de 45 MB (LIMPO). Com o #18, 14/14.

