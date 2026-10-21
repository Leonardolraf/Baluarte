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

## O que o Backend ainda precisa fechar

1. **Endpoint de emissão**, autenticado (Administrador), gravando a inscrição pendente com
   nome/tipo/IP e devolvendo o código.
2. **O enroll aceitando o código** no lugar do `OSQUERY_ENROLL_SECRET`, reconhecido pelo formato.
3. **Uso único e TTL**: o código tem de ser consumido na primeira inscrição e expirar se não for
   usado (24 h). Sem isso é uma credencial de pé, de 12 caracteres úteis e reutilizável.
4. **O relógio lido depois do `FOR UPDATE`** da inscrição pendente, não antes — é o DT10 de
   10/10 (`now()` antes da trava) e o jeito mais fácil de um código de 24 h valer para sempre.
5. **Formato e alfabeto exatos** do código, e a resposta do enroll com código já usado ou
   expirado (para a mensagem de erro do wizard).

Enquanto não vier, o wizard valida pelo que o protótipo usava: `BLT-` + três grupos de 4, no
alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem `0`, `O`, `1` e `I`, que se confundem na tela).
Está em dois lugares, e os dois têm um comentário apontando para cá: `CodigoValido` no
`instalador-baluarte.iss` e `$PadraoCodigo` no `aplicar.ps1`. **Mudou o formato, mude os dois.**

## Arquivos

| Arquivo | O que faz |
|---|---|
| `instalador-baluarte.iss` | O wizard (Inno Setup 6). 7 páginas: boas-vindas, termos, local, servidor+código, pronto para instalar, instalando, concluído. Valida o servidor e o código antes de deixar avançar. |
| `aplicar.ps1` | Ponte entre o wizard e o `instalar-agente.ps1`: valida o código, entrega como `SecureString` e apaga o rastro. |
| `empacotar.ps1` | Gera o `.exe`: baixa e confere o MSI, copia o `ca.crt`, chama o ISCC. |
| `baixar-osquery.ps1` | Baixa o MSI oficial na versão fixa de `agente/osquery-versao.conf` e recusa se o SHA-256 ou a assinatura não baterem. |
| `termos-instalacao.txt` | O texto do passo 2 (UTF-8 com BOM: o Inno lê a licença assim). |

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

Em 21/10/2026 o `certs/` desta máquina está **vazio**. Antes de um teste ponta a ponta:

```bash
sh scripts/gerar-certificados.sh
docker compose up --build -d app
```

Só então empacotar (o `empacotar.ps1` embute `certs/ca.crt`) e rodar o `.exe` como Administrador.

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

**Não** verificado: o wizard rodando. As páginas, a acentuação na tela e o fluxo de Voltar/Avançar
não foram vistos — o instalador exige elevação e o Windows não deixa um processo controlar um
processo elevado. Rodar o `.exe` uma vez e clicar pelas 7 páginas é o próximo passo, e é da
máquina do Leo. Também não foi testada a instalação real (depende dos certificados acima e de um
código de vínculo válido, que depende do Backend).

## Pendências menores

- **Sem ícone nem imagem de marca.** O Inno aceita `SetupIconFile` (.ico), `WizardImageFile`
  (164×314 BMP, nas páginas de boas-vindas e conclusão) e `WizardSmallImageFile` (55×55 BMP, no
  alto das outras). O escudo do protótipo em SVG daria os três e aproximaria bastante a tela do
  desenho original. Hoje o wizard usa o visual padrão do Inno.
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
