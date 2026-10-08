<#
.SYNOPSIS
Instala o agente de estação do Baluarte (B08) no Windows: o MSI OFICIAL do osquery, na versão
fixa de agente\osquery-versao.conf, com SHA-256 e assinatura conferidos antes de instalar.

.DESCRIPTION
Passos: confere o MSI (hash da versão fixa + assinatura Authenticode da osquery/LF Projects),
instala em silêncio (o MSI registra o serviço "osqueryd", automático, como SYSTEM), para o
serviço, grava as flags (a partir de agente\osquery.flags.modelo), a CA local e o segredo de
inscrição em C:\Program Files\osquery\ e liga o serviço de novo.

O segredo NUNCA vai no comando: venha pela variável de ambiente BALUARTE_ENROLL_SECRET, pelo
parâmetro -Segredo (SecureString) ou pela pergunta do próprio script. O arquivo do segredo fica
legível só por SYSTEM e Administradores.

Rodar de novo atualiza as flags, a CA e o segredo e reinicia o serviço. Para remover:
agente\desinstalar-agente.ps1. Não mexe no Windows Defender nem em nenhuma configuração de
segurança da máquina.

.PARAMETER Servidor
Endereço HTTPS do Baluarte como HOST:PORTA, sem https:// (ex.: 192.168.0.10:8443). O nome
precisa estar no certificado do servidor (scripts/gerar-certificados.sh, EXTRA_SAN).

.PARAMETER CaCert
Certificado da CA local (certs\ca.crt do B06; nunca a ca.key). Sem ele, o agente confia nas
autoridades públicas do pacote do osquery (servidor com certificado público).

.PARAMETER Segredo
Segredo de inscrição (o OSQUERY_ENROLL_SECRET do servidor) como SecureString.

.PARAMETER Msi
MSI já baixado (o SHA-256 e a assinatura são conferidos do mesmo jeito).

.PARAMETER SomenteConferir
Não instala nada: baixa (ou usa -Msi), confere hash e assinatura, confere a CA e mostra as flags
que seriam gravadas. Não precisa de administrador.

.EXAMPLE
# PowerShell como Administrador, na raiz do repositório (ou numa cópia da pasta agente\ + ca.crt):
powershell -ExecutionPolicy Bypass -File agente\instalar-agente.ps1 -Servidor 192.168.0.10:8443 -CaCert certs\ca.crt

.EXAMPLE
# Ensaio sem instalar:
powershell -ExecutionPolicy Bypass -File agente\instalar-agente.ps1 -Servidor 192.168.0.10:8443 -CaCert certs\ca.crt -SomenteConferir
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Servidor,
  [string]$CaCert,
  [SecureString]$Segredo,
  [string]$Msi,
  [switch]$SomenteConferir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$TamanhoMinimoSegredo = 16
$AssinanteEsperado = 'OSQUERY a Series of LF Projects, LLC'
$Raiz = Join-Path $env:ProgramFiles 'osquery'
$ArqFlags = Join-Path $Raiz 'osquery.flags'
$ArqSegredo = Join-Path $Raiz 'baluarte.secret'
$ArqCa = Join-Path $Raiz 'certs\baluarte-ca.crt'
$CaDoPacote = Join-Path $Raiz 'certs\certs.pem'
$Servico = 'osqueryd'

function Falhar([string]$Mensagem) { throw "ERRO: $Mensagem" }
function Info([string]$Mensagem) { Write-Host "[agente] $Mensagem" }

# ---- Versão fixa e modelo de flags ------------------------------------------------------
$ArqVersoes = Join-Path $PSScriptRoot 'osquery-versao.conf'
$ArqModelo = Join-Path $PSScriptRoot 'osquery.flags.modelo'
if (-not (Test-Path -LiteralPath $ArqVersoes)) { Falhar "não achei $ArqVersoes (copie a pasta agente\ inteira)." }
if (-not (Test-Path -LiteralPath $ArqModelo)) { Falhar "não achei $ArqModelo (copie a pasta agente\ inteira)." }
$Versoes = @{}
foreach ($linha in Get-Content -LiteralPath $ArqVersoes) {
  if ($linha -match '^([A-Z0-9_]+)=([0-9A-Za-z.]+)$') { $Versoes[$Matches[1]] = $Matches[2] }
}
$Versao = $Versoes['OSQUERY_VERSAO']
$ShaEsperado = $Versoes['OSQUERY_MSI_SHA256']
if (-not $Versao -or -not $ShaEsperado -or $ShaEsperado.Length -ne 64) { Falhar "versão ou SHA-256 do MSI ausente em $ArqVersoes." }
$NomeMsi = "osquery-$Versao.msi"
$Url = "https://github.com/osquery/osquery/releases/download/$Versao/$NomeMsi"

# ---- Conferências antes de mexer na máquina -----------------------------------------------
if ($Servidor -notmatch '^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})?:[0-9]{1,5}$') {
  Falhar "-Servidor deve ser HOST:PORTA, sem https:// nem caminho (recebido: $Servidor)."
}

$ehAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $SomenteConferir -and -not $ehAdmin) { Falhar 'rode o PowerShell como Administrador (ou use -SomenteConferir).' }

$TextoCa = $null
if ($CaCert) {
  if (-not (Test-Path -LiteralPath $CaCert)) { Falhar "CA não encontrada: $CaCert" }
  $TextoCa = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CaCert).Path)
  if ($TextoCa -match 'PRIVATE KEY') { Falhar "$CaCert contém uma CHAVE PRIVADA. Entregue só o certs\ca.crt, nunca a ca.key." }
  if ($TextoCa -notmatch 'BEGIN CERTIFICATE') { Falhar "$CaCert não parece um certificado PEM." }
  $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(, [Text.Encoding]::ASCII.GetBytes($TextoCa))
  $sha = [Security.Cryptography.SHA256]::Create()
  $digital = (($sha.ComputeHash($cert.RawData) | ForEach-Object { $_.ToString('X2') }) -join ':')
  Info "CA: $($cert.Subject), válida até $($cert.NotAfter.ToString('yyyy-MM-dd'))"
  Info "  impressão digital SHA-256: $digital (confira com a saída de gerar-certificados.sh)"
}

# Segredo: parâmetro, variável de ambiente ou pergunta. Nunca é impresso.
$TextoSegredo = $null
if (-not $SomenteConferir) {
  if (-not $Segredo) {
    if ($env:BALUARTE_ENROLL_SECRET) {
      $TextoSegredo = $env:BALUARTE_ENROLL_SECRET
    } else {
      $Segredo = Read-Host -AsSecureString 'Segredo de inscrição (OSQUERY_ENROLL_SECRET do servidor)'
    }
  }
  if ($Segredo) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Segredo)
    try { $TextoSegredo = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  }
  Remove-Item Env:BALUARTE_ENROLL_SECRET -ErrorAction SilentlyContinue
  $TextoSegredo = "$TextoSegredo".Trim()
  if ($TextoSegredo.Length -lt $TamanhoMinimoSegredo) { Falhar "segredo com menos de $TamanhoMinimoSegredo caracteres (o servidor recusaria)." }
  if ($TextoSegredo -match '[\r\n]') { Falhar 'o segredo tem mais de uma linha.' }
}

# ---- MSI: baixa (ou usa o informado) e confere hash e assinatura ---------------------------
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("baluarte-agente-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  if (-not $Msi) {
    $Msi = Join-Path $Tmp $NomeMsi
    Info "baixando $Url"
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Msi
  }
  if (-not (Test-Path -LiteralPath $Msi)) { Falhar "MSI não encontrado: $Msi" }
  $Msi = (Resolve-Path -LiteralPath $Msi).Path
  $ShaObtido = (Get-FileHash -Algorithm SHA256 -LiteralPath $Msi).Hash.ToLowerInvariant()
  if ($ShaObtido -ne $ShaEsperado) {
    Falhar "SHA-256 do MSI não confere (esperado $ShaEsperado, obtido $ShaObtido). Nada foi instalado."
  }
  Info "SHA-256 conferido: $ShaObtido ($NomeMsi)"
  $assinatura = Get-AuthenticodeSignature -LiteralPath $Msi
  if ($assinatura.Status -ne 'Valid' -or $assinatura.SignerCertificate.Subject -notlike "*$AssinanteEsperado*") {
    Falhar "assinatura do MSI inválida ou de outro emissor ($($assinatura.Status); $($assinatura.SignerCertificate.Subject))."
  }
  Info "assinatura válida: $AssinanteEsperado"

  $CaFlag = if ($CaCert) { $ArqCa } else { $CaDoPacote }
  $Flags = [IO.File]::ReadAllText($ArqModelo).Replace('__SERVIDOR__', $Servidor).Replace('__CA__', $CaFlag).Replace('__SEGREDO__', $ArqSegredo)
  if ($Flags -match '__[A-Z]+__') { Falhar 'sobrou marcador sem valor nas flags.' }

  if ($SomenteConferir) {
    Info "-SomenteConferir: nada foi instalado. Flags que seriam gravadas em ${ArqFlags}:"
    ($Flags -split "`r?`n") | Where-Object { $_ -like '--*' } | ForEach-Object { Write-Host "  $_" }
    return
  }

  # ---- Instalação ------------------------------------------------------------------------
  $instalado = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'osquery' } | Select-Object -First 1
  if ($instalado -and $instalado.DisplayVersion -eq $Versao) {
    Info "osquery $Versao já instalado; só atualiza a configuração."
  } else {
    Info "instalando osquery $Versao (msiexec, silencioso)"
    $log = Join-Path $Tmp 'msiexec.log'
    $p = Start-Process -FilePath msiexec.exe -ArgumentList @('/i', "`"$Msi`"", '/qn', '/norestart', '/l*v', "`"$log`"") -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
      $copia = Join-Path ([IO.Path]::GetTempPath()) 'baluarte-agente-msiexec.log'
      Copy-Item -LiteralPath $log -Destination $copia -Force -ErrorAction SilentlyContinue
      Falhar "msiexec terminou com código $($p.ExitCode). Log: $copia"
    }
  }
  if (-not (Get-Service -Name $Servico -ErrorAction SilentlyContinue)) { Falhar "o MSI não registrou o serviço $Servico." }

  # O MSI liga o serviço com as flags padrão: para antes de trocar os arquivos.
  Stop-Service -Name $Servico -Force -ErrorAction SilentlyContinue

  # Segredo: o arquivo nasce vazio, recebe a ACL (só SYSTEM e Administradores, sem herança;
  # SIDs para funcionar em Windows de qualquer idioma) e só então o conteúdo.
  if (-not (Test-Path -LiteralPath $ArqSegredo)) { New-Item -ItemType File -Path $ArqSegredo | Out-Null }
  & icacls.exe $ArqSegredo /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { Falhar "icacls não restringiu $ArqSegredo." }
  $semBom = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($ArqSegredo, $TextoSegredo, $semBom)
  $TextoSegredo = $null

  if ($CaCert) {
    New-Item -ItemType Directory -Path (Split-Path $ArqCa) -Force | Out-Null
    [IO.File]::WriteAllText($ArqCa, $TextoCa, $semBom)
  } elseif (-not (Test-Path -LiteralPath $CaDoPacote)) {
    Falhar "sem -CaCert e sem o pacote de autoridades do osquery em $CaDoPacote."
  }
  [IO.File]::WriteAllText($ArqFlags, $Flags, $semBom)
  Info "flags em $ArqFlags (servidor $Servidor, CA $CaFlag); segredo em $ArqSegredo (SYSTEM e Administradores)"

  # ---- Serviço ---------------------------------------------------------------------------
  Set-Service -Name $Servico -StartupType Automatic
  # Se o processo cair, o Windows o reinicia depois de 1 min (a falha zera em 1 dia).
  & sc.exe failure $Servico reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
  Start-Service -Name $Servico
  $limite = (Get-Date).AddSeconds(20)
  while ((Get-Service -Name $Servico).Status -ne 'Running' -and (Get-Date) -lt $limite) { Start-Sleep -Seconds 1 }
  Start-Sleep -Seconds 5
  if ((Get-Service -Name $Servico).Status -ne 'Running') {
    Falhar "o serviço $Servico não ficou em execução. Veja o Visualizador de Eventos (Aplicativo) e o teste manual abaixo."
  }
  Info "serviço $Servico em execução, início automático."
  Write-Host @"
[agente] pronto. Para conferir:
  - no painel do Baluarte, menu Estações: a máquina aparece logo após a inscrição e o
    inventário chega no primeiro ciclo de coleta (até alguns minutos);
  - Get-Service $Servico   (deve estar Running);
  - teste manual, com o serviço parado (Stop-Service $Servico):
    & "$Raiz\osqueryd\osqueryd.exe" --flagfile "$ArqFlags" --verbose
  - antivírus: veja a seção "Agente de estação" do README (o que observar no Windows Defender).
"@
} finally {
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
