<#
.SYNOPSIS
Aplica a configuracao do agente na estacao: chamado pelo instalador .exe (melhoria #9).

.DESCRIPTION
Ponte entre o wizard do Inno Setup e o agente\instalar-agente.ps1, que e quem de fato mexe na
maquina (MSI do osquery com hash e assinatura conferidos, flags, CA, segredo com ACL so de
SYSTEM e Administradores, servico em inicio automatico). Este script nao reimplementa nada
disso: ele so valida o codigo de vinculo, o entrega como SecureString e apaga o rastro.

O CODIGO NUNCA VAI NA LINHA DE COMANDO. O wizard o grava num arquivo temporario e passa o
caminho em -ArquivoCodigo; aqui ele e lido, convertido para SecureString, e o arquivo e
sobrescrito antes de ser apagado. Linha de comando de processo e visivel para qualquer usuario
da maquina (Get-CimInstance Win32_Process), por isso o desvio.

Espera encontrar na propria pasta: instalar-agente.ps1, osquery-versao.conf,
osquery.flags.modelo e o MSI do osquery.

.PARAMETER Servidor
Endereco do Baluarte como HOST:PORTA, sem https:// (ex.: localhost:8443).

.PARAMETER ArquivoCodigo
Arquivo com o codigo de vinculo (BLT-XXXX-XXXX-XXXX) emitido pelo Administrador no painel.

.PARAMETER Msi
MSI do osquery embutido no instalador.

.PARAMETER CaCert
Certificado da CA local (certs\ca.crt). Sem ele o agente confia nas autoridades publicas do
pacote do osquery, o que nao serve para um servidor com certificado proprio.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Servidor,
  [Parameter(Mandatory = $true)][string]$ArquivoCodigo,
  [Parameter(Mandatory = $true)][string]$Msi,
  [string]$CaCert,
  [string]$Log
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Alfabeto do codigo de vinculo: sem 0/O/1/I, para nao confundir quem le da tela e digita.
# CONFIRMAR COM O BACKEND: formato e alfabeto exatos do codigo (ver LEIAME.md).
$PadraoCodigo = '^BLT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'

function Falhar([string]$m) { Write-Host "ERRO: $m"; exit 1 }
function Info([string]$m) { Write-Host "[aplicar] $m" }

# Sobrescreve antes de apagar: o arquivo some com o conteudo, nao so da listagem.
function ApagarComRastro([string]$caminho) {
  if (-not (Test-Path -LiteralPath $caminho)) { return }
  try {
    $tamanho = [int](Get-Item -LiteralPath $caminho).Length
    if ($tamanho -gt 0) { [IO.File]::WriteAllBytes($caminho, (New-Object byte[] $tamanho)) }
  } catch { }
  Remove-Item -LiteralPath $caminho -Force -ErrorAction SilentlyContinue
}

$Aqui = $PSScriptRoot
$Instalador = Join-Path $Aqui 'instalar-agente.ps1'

# Diario da instalacao: o wizard esconde a janela do PowerShell, entao sem isso uma falha so
# apareceria como um codigo de saida. O codigo de vinculo nunca e impresso (so os 4 ultimos).
if ($Log) { try { Start-Transcript -Path $Log -Force | Out-Null } catch { } }

try {
  if (-not (Test-Path -LiteralPath $Instalador)) { Falhar "nao achei instalar-agente.ps1 em $Aqui." }
  if (-not (Test-Path -LiteralPath $Msi)) { Falhar "nao achei o MSI do osquery: $Msi" }
  if (-not (Test-Path -LiteralPath $ArquivoCodigo)) { Falhar 'o arquivo do codigo de vinculo nao chegou ao instalador.' }

  $codigo = ([IO.File]::ReadAllText($ArquivoCodigo)).Trim().ToUpperInvariant()
  if (-not $codigo) { Falhar 'o codigo de vinculo esta vazio.' }
  if ($codigo -notmatch $PadraoCodigo) {
    Falhar "o codigo de vinculo nao esta no formato BLT-XXXX-XXXX-XXXX. Confira no painel do Baluarte."
  }
  Info "codigo de vinculo no formato esperado (termina em $($codigo.Substring($codigo.Length - 4)))."

  # O segredo de inscricao do osquery nesta estacao E o codigo de vinculo: o osquery nao tem
  # campo livre no enroll (so enroll_secret/host_identifier/host_details), entao e por aqui que
  # o codigo chega ao servidor. O servidor reconhece o formato, consome a inscricao pendente que
  # o Administrador criou com os dados do ativo e a estacao nasce ja vinculada.
  $segredo = ConvertTo-SecureString -String $codigo -AsPlainText -Force
  $codigo = $null

  $argumentos = @{ Servidor = $Servidor; Msi = $Msi; Segredo = $segredo }
  if ($CaCert) {
    if (-not (Test-Path -LiteralPath $CaCert)) { Falhar "nao achei o certificado da CA: $CaCert" }
    $argumentos['CaCert'] = $CaCert
  } else {
    Info 'sem certificado de CA: o agente vai confiar so nas autoridades publicas do pacote do osquery.'
  }

  Info "chamando instalar-agente.ps1 (servidor $Servidor)"
  # Script do PowerShell, nao executavel: nao define $LASTEXITCODE (e com Set-StrictMode ler a
  # variavel nunca definida da erro). Uma falha la vira excecao e cai no catch abaixo, que sai
  # com 1 — e o wizard mostra o diario ao usuario.
  & $Instalador @argumentos
  Info 'configuracao aplicada.'
  exit 0
} catch {
  Write-Host "ERRO: $($_.Exception.Message)"
  exit 1
} finally {
  ApagarComRastro $ArquivoCodigo
  if ($Log) { try { Stop-Transcript | Out-Null } catch { } }
}
