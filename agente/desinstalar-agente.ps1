<#
.SYNOPSIS
Remove o agente de estação do Baluarte (B08) do Windows.

.DESCRIPTION
Para o serviço osqueryd, desinstala o osquery pelo próprio MSI (msiexec /x, silencioso) e apaga
o que o instalador gravou em C:\Program Files\osquery (flags, CA, segredo) e o banco local do
osquery (osquery.db, que guarda a chave da estação). Só toca nessa pasta. -WhatIf mostra o que
seria feito sem fazer.

No painel, a estação continua listada (com o histórico e os achados) e passa a Offline depois
da janela de 3 intervalos de coleta.

.EXAMPLE
# PowerShell como Administrador:
powershell -ExecutionPolicy Bypass -File agente\desinstalar-agente.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Raiz = Join-Path $env:ProgramFiles 'osquery'
$Servico = 'osqueryd'
function Info([string]$Mensagem) { Write-Host "[agente] $Mensagem" }

$ehAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ehAdmin -and -not $WhatIfPreference) { throw 'ERRO: rode o PowerShell como Administrador (ou use -WhatIf).' }

if (Get-Service -Name $Servico -ErrorAction SilentlyContinue) {
  if ($PSCmdlet.ShouldProcess($Servico, 'parar o serviço')) {
    Stop-Service -Name $Servico -Force -ErrorAction SilentlyContinue
    Info "serviço $Servico parado."
  }
} else {
  Info "serviço $Servico não existe."
}

$produtos = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'osquery' })
if ($produtos.Count -eq 0) { Info 'osquery não está instalado pelo MSI.' }
foreach ($p in $produtos) {
  $codigo = $p.PSChildName
  if ($codigo -notmatch '^\{[0-9A-Fa-f-]{36}\}$') { Info "entrada de desinstalação inesperada ($codigo); ignorada."; continue }
  if ($PSCmdlet.ShouldProcess("osquery $($p.DisplayVersion) $codigo", 'desinstalar (msiexec /x)')) {
    $r = Start-Process -FilePath msiexec.exe -ArgumentList @('/x', $codigo, '/qn', '/norestart') -Wait -PassThru
    if ($r.ExitCode -ne 0 -and $r.ExitCode -ne 3010) { throw "ERRO: msiexec /x terminou com código $($r.ExitCode)." }
    Info "osquery $($p.DisplayVersion) desinstalado."
  }
}

# O MSI não apaga o que ele não instalou (segredo, CA, banco local, logs): apaga a pasta inteira,
# que é só do osquery. O caminho é fixo (Program Files\osquery).
if (Test-Path -LiteralPath $Raiz) {
  if ($PSCmdlet.ShouldProcess($Raiz, 'apagar a pasta (flags, CA, segredo, osquery.db, logs)')) {
    Remove-Item -LiteralPath $Raiz -Recurse -Force
    Info "pasta $Raiz apagada."
  }
}
