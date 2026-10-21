# Instalador .exe do agente (melhoria #9)

Empacota o agente de estação do Baluarte num único instalador do Windows: o MSI oficial do
osquery + a configuração do Baluarte + um wizard de 7 passos que, no fim, deixa o serviço
rodando e resolve o **vínculo** da estação com um ativo da plataforma.

É **protótipo**, roda na máquina do Leo e **não é assinado** (Authenticode). O SmartScreen vai
avisar; é esperado. A decisão de não assinar vale só para o nosso `.exe` — a conferência de
assinatura do **MSI do osquery** (emitido pela LF Projects) continua valendo e não deve ser
removida: é barata e é justamente o que se quer mostrar num trabalho de segurança.

## O que já está aqui

| Arquivo | O que faz |
|---|---|
| `baixar-osquery.ps1` | Baixa o MSI oficial para `recursos/` na versão fixa de `agente/osquery-versao.conf` e **recusa** o arquivo se o SHA-256 ou a assinatura não baterem. Rodar de novo só reconfere. |
| `termos-instalacao.txt` | Texto do passo 2 do wizard. |
| `.gitignore` | Mantém o MSI (~19 MB), o `ca.crt` e a pasta de saída fora do repositório. |

Conferido em 21/10/2026: o download traz `osquery-5.23.1.msi` (19,1 MB), com o SHA-256 igual ao
de `osquery-versao.conf` e assinatura válida da `OSQUERY a Series of LF Projects, LLC`.

## O trabalho de máquina já está escrito

`agente/instalar-agente.ps1` já faz **tudo** o que o instalador precisa fazer na estação:
confere o MSI (hash + assinatura), instala em silêncio por `msiexec /qn`, para o serviço, grava
as flags a partir de `osquery.flags.modelo`, grava a CA e o segredo com ACL só de SYSTEM e
Administradores (`icacls`), põe o serviço em início automático com política de reinício
(`sc failure`) e espera ele subir.

Ou seja: o `.exe` é **wizard + empacotamento**, não uma reimplementação. Ele coleta os dados e
chama esse script. Dois pontos conferidos:

- `-Msi <caminho>` já aceita o MSI embutido, sem internet. Testado com `-SomenteConferir`.
- `-Segredo` exige no mínimo 16 caracteres. Um código `BLT-XXXX-XXXX-XXXX` tem 18, então o
  script aceita um token de vínculo como segredo **sem nenhuma alteração**.

## Decisões em aberto (travam o resto)

### 1. Quem gera o código de vínculo

O osquery **não tem campo livre no enroll**: `POST /agentes/osquery/enroll` recebe só
`enroll_secret`, `host_identifier` e `host_details`. Não existe flag que faça o agente mandar um
token extra. Então o código de vínculo só chega ao servidor de um jeito: **sendo** o
`enroll_secret` daquela estação. Daí as duas opções:

- **A — o instalador emite** (o protótipo como está). O wizard coleta nome/tipo/host/IP, pede o
  token ao servidor, grava e mostra o código. Problema: esse endpoint escreve no banco, então
  precisa de credencial — e a única que o `.exe` poderia carregar é o `OSQUERY_ENROLL_SECRET` da
  organização, embutido. Quem tiver o `.exe` inscreve estação falsa e lê a configuração da org.
- **B — o Administrador emite no painel** (recomendação do hub e minha). Ele gera o código
  logado, com RBAC e auditoria, e preenche nome/tipo/IP ali. O wizard só **consome** o código.
  O `.exe` fica sem segredo nenhum e **sem nenhuma chamada de rede**.

As duas são mutuamente exclusivas: não dá para ter o protótipo como está **e** o `.exe` sem
segredo. B inverte os passos 5 e 6 do protótipo e muda o trabalho do Frontend (a `/assets/new`
passa a *gerar* o código em vez de só confirmá-lo).

### 2. Ferramenta

**Inno Setup** (recomendação) ou **.NET/WPF**. As duas decisões estão acopladas: em B o
instalador não faz rede nenhuma, e aí o Pascal Script do Inno dá conta de tudo (páginas,
`msiexec`, arquivos, serviço) — some o único argumento técnico forte a favor do WPF, que era
HTTP + JSON + CA fixada. Em A o WPF leva vantagem real.

Inno dá elevação, desinstalador, entrada em Aplicativos Instalados e o Voltar/Avançar de graça.
O preço é estético: vai ter cara de Inno, não a cara do protótipo em HTML.

Estado da máquina em 21/10/2026: **Inno Setup não está instalado** (precisa de
`winget install JRSoftware.InnoSetup`); o **SDK do .NET 10 está**, com o runtime de desktop.

## Pré-requisito para testar de verdade

O plugin `tls` do osquery **exige HTTPS**, então o alvo local é `localhost:8443` + a CA local —
**não** `localhost:8080` (essa é a API em HTTP, o osqueryd não fala com ela). O certificado local
já traz `DNS:localhost` e `IP:127.0.0.1` no SAN.

Só que `certs/` está **vazio** nesta máquina: antes de qualquer teste ponta a ponta é preciso
rodar `scripts/gerar-certificados.sh` e subir o `app` do compose. O `recursos/ca.crt` é copiado
de `certs/ca.crt` na hora de empacotar e nunca vai para o git (a `ca.key` jamais sai de lá).

**Nunca apontar para a VM de produção** (`baluarte.tail862474.ts.net` / o Funnel): cada teste do
agente criaria uma estação real na produção.

## Sobre o texto dos termos

`termos-instalacao.txt` é o texto da **instalação nesta estação**, e de propósito **não** é uma
cópia do aviso de monitoramento. O aviso canônico mora só em
`backend/src/models/avisoMonitoramento.model.ts` (`TEXTO_AVISO`), é versionado por `VERSAO_AVISO`
e já tem uma cópia literal no mock do frontend que um teste compara — uma terceira cópia aqui
seria mais uma para sair de sincronia. A seção 6 aponta para o aviso da plataforma e o declara
oficial em caso de divergência.

Se o `TEXTO_AVISO` mudar de versão, vale reler este arquivo, mas ele não quebra nenhum teste.
