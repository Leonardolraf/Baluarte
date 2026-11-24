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
# Formato confirmado pelo contrato do Backend em 21/10/2026 (ver LEIAME.md): o agente manda o
# codigo com os tracos e em maiusculas, como gravado aqui, e o servidor compara por hash.
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

# ---- Conferencia da inscricao -------------------------------------------------------------
# O servico se inscreve sozinho quando sobe, e a falha nao deixa rastro em disco: com
# --logger_plugin=tls os logs de status vao para o servidor, e o "Failed enrollment" so aparece
# no console (medido em 21/10 e de novo em 24/11/2026 com o osquery 5.23.1). Servico em execucao
# NAO e estacao inscrita. Entao a conferencia e o teste manual que o instalar-agente.ps1 ja
# recomenda, automatizado: para o servico, roda o MESMO executavel com a MESMA linha de comando
# (lida do registro do servico, sem adivinhar caminho de banco) em primeiro plano por alguns
# segundos, le o console e religa o servico.
#   - banco com chave de no valida: o osquery pede a configuracao direto, sem tentar inscrever;
#   - sem chave (o servico nao conseguiu): tenta inscrever com o codigo ja gasto e o servidor
#     recusa -> "tls_enroll.cpp ... Failed enrollment request".
# A sonda NAO consome codigo: quem consumiu (ou tentou) foi o servico. --disable_watchdog deixa
# um processo so; com o watchdog, matar o pai poderia deixar o processo de trabalho segurando a
# trava do banco e o servico nao subiria de novo.
# O osquery so pede a configuracao depois de ter chave de no (medido: na recusa ele fica preso
# repetindo o enroll e nunca chega ao /config). Entao "pediu /config sem nenhuma recusa" e
# inscrita, tenha a chave vindo do servico antes ou da propria sonda agora.
# A MESMA linha "Failed enrollment" sai na recusa e na falta de rede; so o motivo entre
# parenteses muda (medido em 24/11/2026, osquery 5.23.1):
#   servidor respondeu e recusou (401): "(No node key returned from TLS enroll plugin)"
#   sem conexao / TLS:                  "(Request error: Failed to connect to ...)"
# Tratar os dois como recusa mandaria gerar codigo novo quando o problema e o servidor fora do ar.
function EstadoDoConsole([string]$texto) {
  if ($texto -match 'POST request to URI: \S+/api/agentes/osquery/config') { return 'inscrita' }
  if ($texto -match 'tls_enroll\.cpp:\d+\] Failed enrollment[^\r\n]*No node key returned') { return 'recusada' }
  if ($texto -match 'tls_enroll\.cpp:\d+\] Failed enrollment[^\r\n]*Request error') { return 'inacessivel' }
  return 'indeterminada'
}

function ConferirInscricao {
  $nome = 'osqueryd'
  $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='$nome'"
  if (-not $svc) { Info 'conferencia: servico osqueryd nao encontrado.'; return 'indeterminada' }
  $linha = $svc.PathName.Trim()
  if ($linha.StartsWith('"')) {
    $fim = $linha.IndexOf('"', 1)
    $exe = $linha.Substring(1, $fim - 1); $args0 = $linha.Substring($fim + 1).Trim()
  } else {
    $i = $linha.IndexOf(' '); if ($i -lt 0) { $exe = $linha; $args0 = '' } else { $exe = $linha.Substring(0, $i); $args0 = $linha.Substring($i + 1).Trim() }
  }
  # O servico pode passar --service para o modo de servico do Windows; em primeiro plano, nao.
  $args0 = ($args0 -replace '(^|\s)--service(\s|$)', ' ').Trim()

  # Da ao servico o tempo da primeira tentativa de inscricao (imediata ao subir; nova tentativa a ~9 s).
  Start-Sleep -Seconds 12
  $console = Join-Path $env:TEMP ("baluarte-conferencia-{0}.txt" -f ([guid]::NewGuid().ToString('N')))
  $sonda = $null
  try {
    Stop-Service -Name $nome -Force
    $limite = (Get-Date).AddSeconds(20)
    while ((Get-Process -Name $nome -ErrorAction SilentlyContinue) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 500 }

    $sonda = Start-Process -FilePath $exe -ArgumentList "$args0 --verbose --disable_watchdog" -RedirectStandardError $console -RedirectStandardOutput "$console.out" -WindowStyle Hidden -PassThru
    $estado = 'indeterminada'
    $limite = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $limite) {
      Start-Sleep -Seconds 1
      $texto = if (Test-Path -LiteralPath $console) { [IO.File]::ReadAllText($console) } else { '' }
      $estado = EstadoDoConsole $texto
      if ($estado -ne 'indeterminada') { break }
      if ($sonda.HasExited) { break }
    }
    # Deixa no diario as linhas que decidiram (nenhuma delas tem o codigo ou a chave de no).
    if (Test-Path -LiteralPath $console) {
      Select-String -LiteralPath $console -Pattern 'tls_enroll|tls\.cpp|node_invalid|unsafe permissions|Rocksdb open failed' |
        Select-Object -First 8 | ForEach-Object { Info ("osquery: " + ($_.Line -replace '^\S+ \S+ \d+ ', '')) }
    }
    return $estado
  } finally {
    if ($sonda -and -not $sonda.HasExited) { Stop-Process -Id $sonda.Id -Force -ErrorAction SilentlyContinue; $sonda.WaitForExit(10000) | Out-Null }
    Remove-Item -LiteralPath $console, "$console.out" -Force -ErrorAction SilentlyContinue
    # Religa o servico SEMPRE, seja qual for o resultado: recusado ele continua tentando, e um
    # codigo novo via reinstalacao resolve sem desinstalar.
    try { Start-Service -Name $nome } catch { Info "conferencia: nao consegui religar o servico: $($_.Exception.Message)" }
  }
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

  $estado = ConferirInscricao
  switch ($estado) {
    'inscrita'      { Info 'inscricao confirmada: o agente ja tem chave de no e o servidor entregou a configuracao.'; exit 0 }
    'recusada'      { Info 'inscricao RECUSADA pelo servidor: o codigo de vinculo expirou, ja foi usado ou nao existe.'; exit 3 }
    'inacessivel'   { Info "inscricao NAO confirmada: o agente nao alcancou o servidor $Servidor (rede, porta ou certificado). O codigo pode continuar valido."; exit 4 }
    default         { Info 'inscricao NAO confirmada: a conferencia nao viu nem sucesso nem recusa (servidor fora do ar? veja as linhas acima).'; exit 4 }
  }
} catch {
  Write-Host "ERRO: $($_.Exception.Message)"
  exit 1
} finally {
  ApagarComRastro $ArquivoCodigo
  if ($Log) { try { Stop-Transcript | Out-Null } catch { } }
}
