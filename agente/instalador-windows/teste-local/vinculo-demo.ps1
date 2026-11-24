<#
.SYNOPSIS
Emite um codigo de vinculo BLT no Baluarte local, ou mostra que um codigo ja usado e recusado.

.DESCRIPTION
O painel ainda nao tem tela para emitir o codigo de vinculo (o endpoint existe, a tela nao). Este
script faz o que a tela faria: entra como Administrador e chama POST /api/estacoes/vinculos.

  .\vinculo-demo.ps1 -Acao Emitir   pede e-mail e senha do Administrador, emite e mostra o codigo
  .\vinculo-demo.ps1 -Acao Reusar   pede um codigo ja usado e tenta inscrever com ele: deve dar 401

So para o ambiente LOCAL (https://localhost:8443). Nunca apontar para a VM de producao: cada
codigo consumido la cria uma estacao real.

A senha e o token nunca vao na linha de comando do curl (linha de comando de processo e visivel
para qualquer usuario da maquina): o corpo vai pela entrada padrao e o cabecalho por arquivo
temporario, apagado no fim.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Emitir', 'Reusar')][string]$Acao,
  [string]$Servidor = 'localhost:8443',
  [string]$CaCert,
  [string]$Email = 'admin@empresa.com',
  [SecureString]$Senha,
  [string]$Nome = 'Estacao da apresentacao',
  [string]$Descricao = 'Inscrita pelo instalador .exe',
  [string]$Codigo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ($Servidor -notmatch '^(localhost|127\.0\.0\.1):\d+$') {
  throw "este script e so para o ambiente local (localhost:PORTA). Recebi: $Servidor"
}
if (-not $CaCert) { $CaCert = Join-Path $PSScriptRoot '..\recursos\ca.crt' }
if (-not (Test-Path -LiteralPath $CaCert)) { throw "nao achei a CA local: $CaCert (use -CaCert <caminho>\certs\ca.crt)" }
$Base = "https://$Servidor/api"
$Curl = Join-Path $env:SystemRoot 'System32\curl.exe'

function Chamar([string]$metodo, [string]$url, [string]$corpo, [string]$token) {
  $cab = $null
  try {
    $extra = @()
    if ($token) {
      $cab = [IO.Path]::GetTempFileName()
      [IO.File]::WriteAllText($cab, "authorization: Bearer $token")
      $extra = @('-H', "@$cab")
    }
    # --ssl-no-revoke: a CA local nao publica lista de revogacao e o curl do Windows (Schannel)
    # recusaria a conexao por isso. A confianca continua restrita a --cacert.
    $saida = $corpo | & $Curl -s --ssl-no-revoke --cacert $CaCert -X $metodo $url `
      -H 'content-type: application/json' @extra --data-binary '@-' -w "`n%{http_code}"
    $linhas = ($saida -join "`n").TrimEnd() -split "`n"
    return @{ status = [int]$linhas[-1]; corpo = (($linhas[0..($linhas.Count - 2)]) -join "`n") }
  } finally {
    if ($cab) { Remove-Item -LiteralPath $cab -Force -ErrorAction SilentlyContinue }
  }
}

if ($Acao -eq 'Emitir') {
  if (-not $Senha) { $Senha = Read-Host "Senha de $Email" -AsSecureString }
  $texto = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Senha))
  $login = Chamar 'POST' "$Base/login" (@{ email = $Email; senha = $texto } | ConvertTo-Json -Compress) $null
  $texto = $null
  if ($login.status -ne 200) { throw "login recusado ($($login.status)): $($login.corpo)" }
  $token = ($login.corpo | ConvertFrom-Json).dados.token

  $r = Chamar 'POST' "$Base/estacoes/vinculos" (@{ nome = $Nome; descricao = $Descricao } | ConvertTo-Json -Compress) $token
  if ($r.status -ne 201 -and $r.status -ne 200) { throw "emissao recusada ($($r.status)): $($r.corpo)" }
  $d = ($r.corpo | ConvertFrom-Json).dados
  Write-Host ''
  Write-Host "  Codigo de vinculo:  $($d.codigo)" -ForegroundColor Cyan
  Write-Host "  Estacao:            $Nome"
  Write-Host "  Valido ate:         $(([datetime]$d.expiraEm).ToLocalTime().ToString('dd/MM/yyyy HH:mm')) (uso unico)"
  Write-Host ''
  Write-Host '  O servidor guarda so o hash: este codigo nao aparece de novo.'
} else {
  # -Codigo e aceito porque aqui o codigo ja esta gasto (e o que se quer mostrar); um codigo
  # valido nunca deve ir na linha de comando.
  if (-not $Codigo) { $Codigo = Read-Host 'Codigo ja usado (BLT-XXXX-XXXX-XXXX)' }
  $codigo = $Codigo.Trim().ToUpperInvariant()
  # host_identifier qualquer: o servidor recusa pelo codigo antes de olhar a maquina.
  $r = Chamar 'POST' "$Base/agentes/osquery/enroll" (@{ enroll_secret = $codigo; host_identifier = 'reuso-demonstracao' } | ConvertTo-Json -Compress) $null
  $codigo = $null
  $cor = if ($r.status -eq 401) { 'Green' } else { 'Red' }
  Write-Host ''
  Write-Host "  HTTP $($r.status)" -ForegroundColor $cor
  Write-Host "  $($r.corpo)"
  if ($r.status -eq 401) { Write-Host '  Codigo de uso unico: depois de consumido, nao inscreve outra maquina.' }
}
