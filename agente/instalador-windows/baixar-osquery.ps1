<#
.SYNOPSIS
Baixa o MSI oficial do osquery para recursos\ e confere o SHA-256 e a assinatura Authenticode.

.DESCRIPTION
O instalador .exe do agente (melhoria #9) embute o MSI oficial do osquery para instalar sem
internet. O MSI tem ~15 MB e NAO vai para o git: este script o baixa antes de empacotar, na
versao fixa de agente\osquery-versao.conf, e recusa o arquivo se o hash ou a assinatura nao
baterem — a mesma conferencia que agente\instalar-agente.ps1 faz na estacao.

Rodar de novo com o MSI ja em recursos\ nao baixa nada: so reconfere.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File agente\instalador-windows\baixar-osquery.ps1
#>
[CmdletBinding()]
param(
  [string]$Destino,
  [switch]$Forcar
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$AssinanteEsperado = 'OSQUERY a Series of LF Projects, LLC'
$Aqui = $PSScriptRoot
$ArqVersoes = Join-Path (Split-Path $Aqui -Parent) 'osquery-versao.conf'
if (-not $Destino) { $Destino = Join-Path $Aqui 'recursos' }

function Falhar([string]$m) { throw "ERRO: $m" }
function Info([string]$m) { Write-Host "[baixar-osquery] $m" }

# ---- Versao fixa: a mesma fonte de verdade dos instaladores ------------------------------
if (-not (Test-Path -LiteralPath $ArqVersoes)) { Falhar "nao achei $ArqVersoes." }
$Versoes = @{}
foreach ($linha in Get-Content -LiteralPath $ArqVersoes) {
  if ($linha -match '^([A-Z0-9_]+)=([0-9A-Za-z.]+)$') { $Versoes[$Matches[1]] = $Matches[2] }
}
$Versao = $Versoes['OSQUERY_VERSAO']
$ShaEsperado = $Versoes['OSQUERY_MSI_SHA256']
if (-not $Versao) { Falhar "OSQUERY_VERSAO ausente em $ArqVersoes." }
if (-not $ShaEsperado -or $ShaEsperado.Length -ne 64) { Falhar "OSQUERY_MSI_SHA256 ausente ou invalido em $ArqVersoes." }

$NomeMsi = "osquery-$Versao.msi"
$Url = "https://github.com/osquery/osquery/releases/download/$Versao/$NomeMsi"
New-Item -ItemType Directory -Path $Destino -Force | Out-Null
$Msi = Join-Path $Destino $NomeMsi

# ---- Download (so se precisar) -----------------------------------------------------------
if ((Test-Path -LiteralPath $Msi) -and -not $Forcar) {
  Info "$NomeMsi ja esta em recursos\; so conferindo (use -Forcar para baixar de novo)."
} else {
  Info "baixando $Url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $parcial = "$Msi.parcial"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $parcial
  Move-Item -LiteralPath $parcial -Destination $Msi -Force
}

# ---- Conferencias ------------------------------------------------------------------------
$ShaObtido = (Get-FileHash -Algorithm SHA256 -LiteralPath $Msi).Hash.ToLowerInvariant()
if ($ShaObtido -ne $ShaEsperado) {
  Remove-Item -LiteralPath $Msi -Force -ErrorAction SilentlyContinue
  Falhar "SHA-256 nao confere (esperado $ShaEsperado, obtido $ShaObtido). O arquivo foi apagado."
}
Info "SHA-256 conferido: $ShaObtido"

$assinatura = Get-AuthenticodeSignature -LiteralPath $Msi
if ($assinatura.Status -ne 'Valid' -or $assinatura.SignerCertificate.Subject -notlike "*$AssinanteEsperado*") {
  Falhar "assinatura invalida ou de outro emissor ($($assinatura.Status); $($assinatura.SignerCertificate.Subject))."
}
Info "assinatura valida: $AssinanteEsperado"

$tamanho = [math]::Round((Get-Item -LiteralPath $Msi).Length / 1MB, 1)
Info "pronto: $Msi ($tamanho MB, osquery $Versao)"
