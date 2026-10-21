# Instalador .exe do agente (melhoria #9)

Empacota o agente de estação do Baluarte num único instalador do Windows: o MSI oficial do
osquery + a configuração do Baluarte + um wizard de 7 passos que, no fim, deixa o serviço
rodando e a estação vinculada a um ativo da plataforma.

É **protótipo**, roda na máquina do Leo e **não é assinado** (Authenticode). O SmartScreen vai
avisar na primeira execução; é esperado. Essa decisão vale só para o nosso `.exe` — a conferência
de hash **e** de assinatura do **MSI do osquery** (emitido pela LF Projects) continua valendo em
dois momentos: ao empacotar e ao instalar na estação.

## Como funciona o vínculo

Decidido em 21/10/2026 (Leo, pelo hub): **o Administrador emite o código no painel**, o wizard
só o consome.

O osquery **não tem campo livre no enroll**: `POST /agentes/osquery/enroll` recebe só
`enroll_secret`, `host_identifier` e `host_details`. Não existe flag que faça o agente mandar um
token extra. Logo, o código de vínculo só chega ao servidor de um jeito: **sendo** o
`enroll_secret` daquela estação.

1. O Administrador, logado no painel, gera o código para um ativo novo e informa ali o nome, o
   tipo e o IP. O servidor grava uma inscrição pendente com esses dados e devolve
   `BLT-XXXX-XXXX-XXXX`.
2. O wizard pede o servidor e o código. Ele **não faz chamada de rede nenhuma**.
3. O código é gravado em `C:\Program Files\osquery\baluarte.secret`, com ACL só de SYSTEM e
   Administradores.
4. O osqueryd sobe e manda o código como `enroll_secret`. O servidor reconhece o formato,
   consome a inscrição pendente e a estação nasce já vinculada e com o nome escolhido.

O ganho sobre a alternativa (o instalador emitindo o código) é que o `.exe` **não carrega
segredo nenhum**. Se ele emitisse, precisaria do `OSQUERY_ENROLL_SECRET` da organização embutido,
e qualquer um com o arquivo inscreveria estação falsa e leria a configuração da org.

## Contrato fechado com o Backend (21/10/2026)

O formato bate com o que já estava implementado, sem mudança: `BLT-` + três grupos de 4 no alfabeto
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 18 caracteres. O agente manda com os traços e em maiúsculas,
como o wizard grava; o servidor normaliza (`trim` + maiúsculas) e compara por hash. Código
desconhecido, expirado ou já usado dão todos **`401 SEGREDO_INVALIDO`**, mensagem única, de
propósito, para não permitir enumeração. A emissão é `POST /estacoes/vinculos` (Administrador).
Uso único, TTL de 24 h, e o relógio lido depois do `FOR UPDATE`.

A implementação do servidor é do Backend, em branch, pós-demo. **Até ela subir não há como testar
ponta a ponta**: um código emitido não existe.

### Não há verificação de código pela rede, e é de propósito

Uma versão anterior do contrato oferecia um `GET /agentes/osquery/vinculos/:codigo` **público**,
para o wizard pré-validar o código com um botão "Testar código". Foi recusado aqui e **retirado do
contrato** pelo Backend em 21/10/2026, por dois motivos:

1. **Contradizia o próprio contrato.** O enroll devolve um 401 único para desconhecido, expirado e
   usado justamente para não permitir enumeração — e aquele endpoint devolvia
   `motivo: EXPIRADO | USADO | DESCONHECIDO` numa rota aberta. Era o oráculo que o 401 nega.
2. **Reintroduzia rede no instalador.** O `.exe` não fazer chamada nenhuma é a propriedade que
   torna o desenho limpo: sem segredo embutido, sem CA para validar na hora do wizard, sem
   servidor precisando estar de pé para a instalação andar.

Quem vê o estado de um código é o **painel**, por `GET /estacoes/vinculos` (Administrador,
autenticado). O instalador valida só o formato, localmente.

### Reexecutar o instalador exige um código novo

O consumo é uso único por código, sempre. Reexecutar numa máquina já inscrita é uma reinscrição
legítima — é o caminho de recuperação que a tela de falha indica — e **exige um código fresco**:
o próprio código já consumido dá `401 SEGREDO_INVALIDO`, nunca é reaproveitado em silêncio. Isso
importa para o texto da tela final, que manda gerar um novo no painel; se dissesse só "execute de
novo", o operador ficaria preso.

### Falha de inscrição não aparece no wizard

**Limitação conhecida, não resolvida.** A inscrição acontece quando o `osqueryd` sobe, *depois* que
o `instalar-agente.ps1` termina, e o que o instalador confere é só que o serviço ficou em execução.
Um código errado ou expirado produz exatamente o mesmo caminho: serviço de pé, enroll recusado com
401, e nada no painel. **Serviço em execução não é estação inscrita.**

Por isso a tela final não afirma que deu certo: ela manda conferir no painel e diz o que fazer se a
máquina não aparecer.

### Por que a correção óbvia não funciona (medido em 21/10/2026)

A ideia natural é o instalador ler o resultado da inscrição no log do osquery. **Não dá, com as
flags de hoje.** Medido extraindo o `osqueryd.exe` do MSI (`msiexec /a`, sem instalar nada) e
rodando-o contra a `localhost:8443` com ninguém escutando:

- A falha sai assim, e só no console:
  `W tls_enroll.cpp:101] Failed enrollment request to https://.../api/agentes/osquery/enroll
  (Request error: ...) retrying...`, repetida a cada ~9 s.
- **A pasta de log fica vazia.** Com `--logger_plugin=tls`, os logs de status vão para o servidor,
  não para o disco — e quando a inscrição falha não há servidor com quem falar. Rodando como
  serviço do Windows, esse texto não vai para lugar nenhum.

Ou seja: um detector que lesse o log local **nunca dispararia**, e pareceria funcionar. É a mesma
armadilha da tela que ele deveria consertar.

### Três caminhos, e o que falta medir antes de escolher

1. ~~**Ligar `filesystem` no `osquery.flags.modelo`**~~ — **descartada pelo Backend em 21/10/2026.**
   O modelo é o que **toda** estação usa em produção: ligaria log de status em disco em todas, para
   sempre, por um benefício que só existe nos segundos da instalação. O flags permanente segue
   `tls` apenas, e a restrição é: **nada de pegada permanente**. Não repropor.
2. **Flags efêmeras só durante a instalação**: subir o serviço uma vez com um arquivo temporário
   que inclui `filesystem`, observar, e depois gravar as flags permanentes e reiniciar. Não deixa
   rastro no permanente, mas põe um para-e-sobe a mais no caminho da instalação.

   **Esse arquivo é do instalador, não do Backend.** É um flagfile temporário criado aqui, em
   `{tmp}`, e nada tem a ver com o `agente/osquery.flags.modelo`, que continua intocado. Ou seja,
   esta opção **não depende de ninguém** — está disponível mesmo se a 3 cair.
3. **Sonda em primeiro plano, sem mudar flag nenhuma** (preferida). Antes de ligar o serviço, rodar
   o `osqueryd.exe` uma vez em primeiro plano com as flags definitivas, lendo a saída padrão
   diretamente — é exatamente ali que a linha de falha aparece, como medido acima. A inscrição fica
   gravada no banco do osquery (`osquery.db`), então o serviço sobe depois já inscrito. Nenhum
   arquivo de log, nenhuma flag a mais, nada permanente.

   **Duas armadilhas, as duas fatais se erradas:**
   - A sonda tem de usar o **mesmo `--database_path` do serviço** (o padrão,
     `C:\Program Files\osquery\osquery.db`). Com banco separado, a sonda consome o código e o
     serviço tenta se inscrever de novo — e como o código é de **uso único**, ele toma `401` e a
     estação nunca sobe. Ou seja, a sonda teria *causado* a falha que foi feita para detectar.
     Na prática isso sai de graça passando o flagfile definitivo sem sobrescrever nada; o perigo é
     alguém "isolar" a sonda num banco temporário achando que é mais limpo.
   - O serviço roda como **SYSTEM** e a sonda rodaria como o **administrador** que abriu o
     instalador. Os dois escrevem o mesmo `osquery.db`, e na medição da falha o osquery já
     reclamou `Failed to apply safe permssions to the database`. Se o banco ficar com dono ou ACL
     que o serviço não aceite, ele não abre — e a falha apareceria longe da causa. **Conferir isso
     na medição**, não depois.

A escolha entre 2 e 3 é do instalador, não do servidor — as duas respeitam "nada permanente" e
nenhuma das duas exige o Backend tocar nas flags de produção. O endpoint vem na branch
`feat/vinculo-agente` do Backend.

A 3 é a preferida **por enquanto**, e o Backend também prefere ela — mas isso não a escolhe: a
preferência dele foi dada antes do risco de ACL acima existir, e a medição (b) ainda pode derrubá-la.
Se cair, a 2 assume sem depender de nada nem de ninguém.

**O que impede escolher agora:** as duas dependem de reconhecer o **sucesso**, e só a falha está
medida. Não se sabe o que o osquery escreve quando a inscrição dá certo — e tratar "não apareceu a
linha de falha" como sucesso é a mesma troca que este documento inteiro critica: ausência de dado
lida como ausência de risco. A medição do caso de sucesso exige o servidor de pé com o endpoint do
Backend. **Até lá, nada disso é implementado**, e a tela final continua mandando conferir no painel
— que é verdadeiro.

## O que o Backend ainda precisa fechar

Nada do contrato. Ficaram dois pontos em aberto do lado dele, nenhum travando este diretorio:
se o responsavel pela maquina aparece no ativo-estacao (hoje fica so no vinculo) e se o Analista
tambem pode emitir codigo, alem do Administrador.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `instalador-baluarte.iss` | O wizard (Inno Setup 6). 7 páginas: boas-vindas, termos, local, servidor+código, pronto para instalar, instalando, concluído. Valida o servidor e o código antes de deixar avançar. |
| `aplicar.ps1` | Ponte entre o wizard e o `instalar-agente.ps1`: valida o código, entrega como `SecureString` e apaga o rastro. |
| `empacotar.ps1` | Gera o `.exe`: baixa e confere o MSI, copia o `ca.crt`, chama o ISCC. |
| `baixar-osquery.ps1` | Baixa o MSI oficial na versão fixa de `agente/osquery-versao.conf` e recusa se o SHA-256 ou a assinatura não baterem. |
| `termos-instalacao.txt` | O texto do passo 2 (UTF-8 com BOM: o Inno lê a licença assim). |
| `recursos/gerar-imagens.py` | Rasteriza o escudo canônico do produto no ícone e nas duas imagens do wizard. Rodado uma vez; as saídas estão versionadas ao lado. |

## O trabalho de máquina não está aqui

`agente/instalar-agente.ps1` já faz tudo o que precisa ser feito na estação: confere o MSI, instala
em silêncio por `msiexec /qn`, para o serviço, grava as flags a partir de `osquery.flags.modelo`,
grava a CA e o segredo com ACL só de SYSTEM e Administradores (`icacls`), põe o serviço em início
automático com política de reinício (`sc failure`) e espera ele subir.

O `.exe` é **wizard + empacotamento**, não uma reimplementação. Dois pontos conferidos em
21/10/2026: `-Msi <caminho>` já aceita o MSI embutido (sem internet), e `-Segredo` exige 16+
caracteres, sendo que um código tem 18 — ou seja, o script aceita um código de vínculo como
segredo **sem nenhuma alteração**. Por isso este diretório não altera nada em `agente/`.

### O código nunca passa por linha de comando

Linha de comando de processo é visível para qualquer usuário da máquina
(`Get-CimInstance Win32_Process`). O wizard grava o código num arquivo em `{tmp}` e passa o
caminho; o `aplicar.ps1` lê, converte para `SecureString`, e no `finally` sobrescreve o arquivo
com zeros antes de apagá-lo. O diário da instalação mostra só os 4 últimos caracteres.

## Modo demonstração

```powershell
powershell -ExecutionPolicy Bypass -File agente\instalador-windows\empacotar.ps1 -Demonstracao
```

Sai em `saida\InstaladorAgenteBaluarte-0.1.0-DEMONSTRACAO.exe` (~2 MB). É o **mesmo wizard**,
pelas mesmas 7 páginas, mas **incapaz de instalar**: não embute o MSI do osquery, não chama o
`aplicar.ps1`, não pede elevação, grava os poucos arquivos numa pasta temporária do usuário e não
se registra em Aplicativos Instalados. A tela final diz, com todas as letras, que nada foi alterado
no computador.

Serve para mostrar o fluxo numa máquina qualquer, sem Docker, sem certificados e sem backend.

**Por que existe:** no instalador real, a página "Pronto para instalar" tem um botão que inicia uma
instalação de verdade do osquery — o MSI está embutido e não precisa de servidor nenhum para rodar.
Num walkthrough, um clique a mais instala um serviço na máquina de quem está apresentando. O modo
demonstração torna esse clique inofensivo em vez de depender de cuidado.

O nome do arquivo carrega `DEMONSTRACAO` de propósito: os dois binários são parecidos na tela, e a
diferença importa.

## Como gerar

```powershell
powershell -ExecutionPolicy Bypass -File agente\instalador-windows\empacotar.ps1
```

Sai em `saida\InstaladorAgenteBaluarte-0.1.0.exe` (~20,5 MB com o MSI embutido). Para empacotar de
propósito sem a CA local (servidor com certificado público), `-SemCa`.

Precisa do Inno Setup: `winget install JRSoftware.InnoSetup`. O winget instala **por usuário**, em
`%LOCALAPPDATA%\Programs\Inno Setup 6`, não em Program Files — o `empacotar.ps1` procura nos três
lugares.

## Pré-requisito para testar de verdade

O plugin `tls` do osquery **exige HTTPS**: o alvo local é `localhost:8443` + a CA local, **não**
`localhost:8080` (essa é a API em HTTP, o osqueryd não fala com ela). O certificado local já traz
`DNS:localhost` e `IP:127.0.0.1` no SAN.

Os certificados locais **foram gerados em 21/10/2026** (`sh scripts/gerar-certificados.sh`, pelo
openssl do próprio Git Bash — o `--docker` é opcional e não foi necessário). A CA é
`CN=Baluarte CA local`, válida até 2036-10-18, e o `.exe` do `saida/` já vai **com ela embutida**.

Falta subir o servidor antes do teste ponta a ponta:

```bash
docker compose up --build -d app        # HTTPS em https://localhost:8443
curl --cacert certs/ca.crt https://localhost:8443/
```

Depois é rodar o `.exe` como Administrador, com um código emitido pelo painel.

**Trocou a CA?** Gere o pacote de novo: a `ca.crt` vai dentro do `.exe`, e um instalador antigo
passa a confiar numa autoridade que não existe mais.

**Nunca apontar para a VM de produção** (`baluarte.tail862474.ts.net` / o Funnel): cada teste do
agente criaria uma estação real na produção.

## O que foi verificado e o que não foi

Verificado em 21/10/2026:

- O download traz `osquery-5.23.1.msi` (19,1 MB), com o SHA-256 igual ao de `osquery-versao.conf`
  e assinatura válida da `OSQUERY a Series of LF Projects, LLC`.
- O `.iss` compila e gera o `.exe` de 20,5 MB.
- A validação do código no `aplicar.ps1`, contra uma cópia do layout instalado: código com
  caractere fora do alfabeto, vazio e de tamanho errado são recusados; minúsculo e com espaços é
  normalizado e repassado; o arquivo temporário é apagado nos quatro casos; o diário mostra só os
  4 últimos caracteres.
- O ícone do produto está embutido no `.exe` (extraído do binário compilado e conferido na tela).

**Não** verificado: o wizard rodando. As páginas, a acentuação na tela e o fluxo de Voltar/Avançar
não foram vistos — o instalador exige elevação e o Windows não deixa um processo controlar um
processo elevado. Rodar o `.exe` uma vez e clicar pelas 7 páginas é o próximo passo, e é da
máquina do Leo. Também não foi testada a instalação real (depende dos certificados acima e de um
código de vínculo válido, que depende do Backend).

## Pendências menores

- **A marca aparece, o texto do protótipo não.** O painel da página de boas-vindas traz o escudo
  sobre a tinta escura `#0B1220`, a mesma do cabeçalho do protótipo, mas sem o letreiro
  "BALUARTE" (exigiria embutir a fonte Archivo). O resto do wizard é o visual padrão do Inno: a
  trilha de passos à esquerda do protótipo em HTML não existe no Inno, que marca a posição pelo
  próprio fluxo de páginas.
- **Página "Local de instalação".** Ela escolhe onde ficam os nossos arquivos (scripts, `ca.crt`,
  desinstalador). O osquery em si vai para `C:\Program Files\osquery`, onde o MSI oficial o
  coloca, e isso não é configurável sem mexer no MSI.

## Sobre o texto dos termos

`termos-instalacao.txt` cobre a **instalação nesta estação** e de propósito **não** é cópia do
aviso de monitoramento. O aviso canônico mora só em
`backend/src/models/avisoMonitoramento.model.ts` (`TEXTO_AVISO`), é versionado por `VERSAO_AVISO` e
já tem uma cópia literal no mock do frontend que um teste compara — uma terceira cópia aqui seria
mais uma fonte de dessincronia. A seção 6 aponta para o aviso da plataforma e o declara oficial em
caso de divergência.
