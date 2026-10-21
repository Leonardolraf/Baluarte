<#
.SYNOPSIS
Gera o instalador .exe do agente do Baluarte (melhoria #9).

.DESCRIPTION
Faz as tres coisas na ordem: baixa e confere o MSI oficial do osquery (baixar-osquery.ps1),
copia o certificado da CA local para recursos\ e compila o instalador-baluarte.iss com o
compilador do Inno Setup (ISCC). A saida fica em saida\.

O .exe NAO e assinado de proposito (prototipo): o SmartScreen vai avisar na primeira execucao.
A conferencia de hash e assinatura do MSI do osquery continua valendo, e acontece na estacao.

.PARAMETER CaCert
Certificado da CA local a embutir. Padrao: certs\ca.crt na raiz do repositorio. Sem ele o
agente so confia nas autoridades publicas do pacote do osquery, o que NAO serve para um
servidor com certificado proprio: o enroll falha no TLS. Gere com scripts\gerar-certificados.sh.

.PARAMETER SemCa
Empacota sem o certificado, de proposito (ex.: servidor com certificado publico).

.PARAMETER Iscc
Caminho do ISCC.exe, se nao estiver nos lugares conhecidos.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File agente\instalador-windows\empacotar.ps1
#>
[CmdletBinding()]
param(
  [string]$CaCert,
  [switch]$SemCa,
  [string]$Iscc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Aqui = $PSScriptRoot
$Raiz = (Resolve-Path (Join-Path $Aqui '..\..')).Path
$Recursos = Join-Path $Aqui 'recursos'
$Saida = Join-Path $Aqui 'saida'
$ArqIss = Join-Path $Aqui 'instalador-baluarte.iss'
$ArqVersoes = Join-Path (Split-Path $Aqui -Parent) 'osquery-versao.conf'

function Falhar([string]$m) { throw "ERRO: $m" }
function Info([string]$m) { Write-Host "[empacotar] $m" }

# ---- ISCC -------------------------------------------------------------------------------
# O winget instala o Inno Setup por usuario, em %LOCALAPPDATA%\Programs, nao em Program Files.
if (-not $Iscc) {
  $candidatos = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
  )
  $Iscc = $candidatos | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Iscc -or -not (Test-Path -LiteralPath $Iscc)) {
  Falhar "nao achei o ISCC.exe. Instale com: winget install JRSoftware.InnoSetup (ou passe -Iscc <caminho>)."
}
Info "compilador: $Iscc"

# ---- Versao do osquery: a mesma fonte de verdade dos instaladores -----------------------
if (-not (Test-Path -LiteralPath $ArqVersoes)) { Falhar "nao achei $ArqVersoes." }
$Versao = $null
foreach ($linha in Get-Content -LiteralPath $ArqVersoes) {
  if ($linha -match '^OSQUERY_VERSAO=([0-9A-Za-z.]+)$') { $Versao = $Matches[1] }
}
if (-not $Versao) { Falhar "OSQUERY_VERSAO ausente em $ArqVersoes." }
Info "osquery $Versao"

# ---- MSI oficial ------------------------------------------------------------------------
# Script do PowerShell, nao executavel: nao define $LASTEXITCODE. Uma falha ali vira excecao
# (ErrorActionPreference = Stop) e para este script; o que confere aqui e o arquivo no fim.
& (Join-Path $Aqui 'baixar-osquery.ps1')
$Msi = Join-Path $Recursos "osquery-$Versao.msi"
if (-not (Test-Path -LiteralPath $Msi)) { Falhar "o MSI nao esta em $Msi." }

# ---- Certificado da CA ------------------------------------------------------------------
$CaDestino = Join-Path $Recursos 'ca.crt'
if ($SemCa) {
  Remove-Item -LiteralPath $CaDestino -Force -ErrorAction SilentlyContinue
  Info 'empacotando SEM certificado de CA (-SemCa): o agente vai confiar so em autoridades publicas.'
} else {
  if (-not $CaCert) { $CaCert = Join-Path $Raiz 'certs\ca.crt' }
  if (-not (Test-Path -LiteralPath $CaCert)) {
    Falhar @"
nao achei o certificado da CA local em $CaCert.
O plugin tls do osquery exige HTTPS, e com um servidor de certificado proprio (o Docker local
na 8443) o agente precisa confiar nessa CA, senao a inscricao falha no TLS.
Gere a CA e o certificado do servidor com:  sh scripts/gerar-certificados.sh
Ou, se o servidor tem certificado publico, empacote com -SemCa.
"@
  }
  $texto = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CaCert).Path)
  # A ca.key NUNCA sai do certs/: se vier chave privada no arquivo, para tudo.
  if ($texto -match 'PRIVATE KEY') { Falhar "$CaCert contem uma CHAVE PRIVADA. Embuta so o certs\ca.crt, nunca a ca.key." }
  if ($texto -notmatch 'BEGIN CERTIFICATE') { Falhar "$CaCert nao parece um certificado PEM." }
  New-Item -ItemType Directory -Path $Recursos -Force | Out-Null
  Copy-Item -LiteralPath $CaCert -Destination $CaDestino -Force
  $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(, [Text.Encoding]::ASCII.GetBytes($texto))
  Info "CA embutida: $($cert.Subject), valida ate $($cert.NotAfter.ToString('yyyy-MM-dd'))"
}

# ---- Compilacao -------------------------------------------------------------------------
New-Item -ItemType Directory -Path $Saida -Force | Out-Null
Info 'compilando o instalador'
& $Iscc "/DOsqueryVersao=$Versao" "/O$Saida" $ArqIss
if ($LASTEXITCODE -ne 0) { Falhar "o ISCC terminou com codigo $LASTEXITCODE." }

$exe = Get-ChildItem -LiteralPath $Saida -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { Falhar 'o ISCC nao gerou .exe.' }
$mb = [math]::Round($exe.Length / 1MB, 1)
Write-Host ""
Info "pronto: $($exe.FullName) ($mb MB)"
Info 'nao assinado: o SmartScreen vai avisar na primeira execucao (Mais informacoes > Executar assim mesmo).'
