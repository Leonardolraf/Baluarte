; Instalador do Agente Baluarte (melhoria #9) - Inno Setup 6
;
; Empacota o MSI OFICIAL do osquery + a configuracao do Baluarte num unico .exe, com um wizard
; de 7 passos. O trabalho de maquina NAO esta aqui: quem mexe na estacao e o
; agente\instalar-agente.ps1, chamado por aplicar.ps1 (ver LEIAME.md). Este script e o wizard
; e o empacotamento.
;
; NAO ASSINADO de proposito: e prototipo, roda na maquina do Leo, e o SmartScreen vai avisar.
; A conferencia de hash e de assinatura Authenticode do MSI do osquery continua valendo e e
; feita pelo instalar-agente.ps1 na hora de instalar.
;
; Compilar: empacotar.ps1 (ele baixa o MSI, copia o ca.crt e chama o ISCC com /D).

#ifndef OsqueryVersao
  #define OsqueryVersao "5.23.1"
#endif
#define MeuNome "Agente Baluarte"
#define MinhaVersao "0.1.0"
#define MinhaEmpresa "Baluarte"
#define OsqueryMsi "osquery-" + OsqueryVersao + ".msi"

[Setup]
AppId={{B4A1F7C2-6E3D-4A58-9C0B-1D7E2A9F5C34}
AppName={#MeuNome}
AppVersion={#MinhaVersao}
AppVerName={#MeuNome} {#MinhaVersao}
AppPublisher={#MinhaEmpresa}
VersionInfoDescription=Instalador do Agente de Monitoramento Baluarte
VersionInfoVersion={#MinhaVersao}
DefaultDirName={autopf}\Baluarte\Agente
DefaultGroupName=Baluarte
DisableProgramGroupPage=yes
; O agente roda como servico do Windows e o MSI do osquery escreve em Program Files:
; sem administrador nao ha instalacao possivel.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=saida
OutputBaseFilename=InstaladorAgenteBaluarte-{#MinhaVersao}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; As 7 paginas do wizard: boas-vindas, termos, local, servidor+codigo, pronto, instalando,
; concluido. O Inno esconde a de boas-vindas no estilo moderno; aqui ela faz parte do fluxo.
DisableWelcomePage=no
LicenseFile=termos-instalacao.txt
UninstallDisplayName={#MeuNome}
; Marca: o escudo canonico do produto (baluarte-frontend\public\baluarte.svg), rasterizado por
; recursos\gerar-imagens.py. WizardImageFile e o painel das paginas de boas-vindas e conclusao;
; WizardSmallImageFile, o selo no alto das demais.
SetupIconFile=recursos\baluarte.ico
WizardImageFile=recursos\wizard-grande.bmp
WizardSmallImageFile=recursos\wizard-pequeno.bmp
UninstallDisplayIcon={app}\baluarte.ico

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
brazilianportuguese.WelcomeLabel1=Instalar o [name]
brazilianportuguese.WelcomeLabel2=O agente roda em segundo plano como serviço do Windows e envia à plataforma um inventário técnico desta estação, para identificar riscos de segurança.%n%nSerão instalados:%n      Serviço de coleta baseado em osquery, com início automático%n      Verificações periódicas de programas, portas e versão do sistema%n      Conexão segura (TLS) com o servidor Baluarte da sua organização%n%nNenhum arquivo pessoal, conteúdo ou senha é coletado.
brazilianportuguese.FinishedHeadingLabel=Tudo pronto

[Files]
; O wizard e a ponte.
Source: "aplicar.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "termos-instalacao.txt"; DestDir: "{app}"; Flags: ignoreversion
; O icone fica instalado para a entrada em Aplicativos Instalados (UninstallDisplayIcon).
Source: "recursos\baluarte.ico"; DestDir: "{app}"; Flags: ignoreversion
; O trabalho de maquina, reaproveitado da pasta agente\ sem alteracao.
Source: "..\instalar-agente.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\desinstalar-agente.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\osquery-versao.conf"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\osquery.flags.modelo"; DestDir: "{app}"; Flags: ignoreversion
; O MSI oficial do osquery, embutido para instalar sem internet (baixar-osquery.ps1).
Source: "recursos\{#OsqueryMsi}"; DestDir: "{app}"; Flags: ignoreversion
; A CA local do Baluarte (certs\ca.crt). Opcional: sem ela o agente so confia em autoridades
; publicas, o que nao serve para um servidor com certificado proprio.
Source: "recursos\ca.crt"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[UninstallRun]
; Remove o servico e o osquery antes de apagar a pasta (o script nao recebe parametros).
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -NonInteractive -File ""{app}\desinstalar-agente.ps1"""; StatusMsg: "Removendo o serviço do agente..."; Flags: runhidden waituntilterminated; RunOnceId: "RemoverAgente"

[UninstallDelete]
Type: files; Name: "{app}\instalacao.log"

[Code]
const
  ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

var
  PaginaVinculo: TInputQueryWizardPage;
  Falhou: Boolean;

{ ---- Validacao -------------------------------------------------------------------------- }

{ HOST:PORTA, sem esquema nem caminho. O Pascal Script do Inno nao tem expressao regular,
  entao a conferencia e manual - a mesma que o instalar-agente.ps1 faz com regex. }
function ServidorValido(S: String): Boolean;
var
  I, Dois, Porta: Integer;
  Host, Texto: String;
begin
  Result := False;
  if (Pos('://', S) > 0) or (Pos('/', S) > 0) or (Pos(' ', S) > 0) then Exit;
  Dois := Pos(':', S);
  if (Dois < 2) or (Dois = Length(S)) then Exit;
  Host := Copy(S, 1, Dois - 1);
  Texto := Copy(S, Dois + 1, Length(S) - Dois);
  { host: letras, digitos, ponto e hifen; nao comeca com ponto nem hifen }
  for I := 1 to Length(Host) do
    if not (((Host[I] >= 'a') and (Host[I] <= 'z')) or ((Host[I] >= 'A') and (Host[I] <= 'Z'))
         or ((Host[I] >= '0') and (Host[I] <= '9')) or (Host[I] = '.') or (Host[I] = '-')) then Exit;
  if (Host[1] = '.') or (Host[1] = '-') then Exit;
  { porta: so digitos, 1..65535 }
  if (Length(Texto) < 1) or (Length(Texto) > 5) then Exit;
  for I := 1 to Length(Texto) do
    if not ((Texto[I] >= '0') and (Texto[I] <= '9')) then Exit;
  Porta := StrToIntDef(Texto, 0);
  if (Porta < 1) or (Porta > 65535) then Exit;
  Result := True;
end;

{ BLT-XXXX-XXXX-XXXX, alfabeto sem 0/O/1/I para nao confundir quem le da tela e digita.
  Formato confirmado pelo contrato do Backend em 21/10/2026 (ver LEIAME.md). O servidor normaliza
  o recebido com trim + maiusculas e compara por hash, que e o que o wizard grava. }
function CodigoValido(S: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  if Length(S) <> 18 then Exit;
  if Copy(S, 1, 4) <> 'BLT-' then Exit;
  if (S[9] <> '-') or (S[14] <> '-') then Exit;
  for I := 1 to 18 do
    if (I <> 4) and (I <> 9) and (I <> 14) then
      if Pos(S[I], ALFABETO) = 0 then Exit;
  Result := True;
end;

function CodigoInformado: String;
begin
  Result := Uppercase(Trim(PaginaVinculo.Values[1]));
end;

function ServidorInformado: String;
begin
  Result := Trim(PaginaVinculo.Values[0]);
end;

{ ---- Wizard ----------------------------------------------------------------------------- }

procedure InitializeWizard;
begin
  Falhou := False;
  PaginaVinculo := CreateInputQueryPage(wpSelectDir,
    'Servidor e código de vínculo',
    'Informe onde o agente deve se conectar e o código emitido no painel.',
    'O código de vínculo é gerado pelo Administrador no Baluarte, na tela de ativos, e já carrega o nome, o tipo e o IP deste equipamento. Ele é de uso único e expira em 24 horas.');
  PaginaVinculo.Add('Servidor (host:porta, sem https://)', False);
  PaginaVinculo.Add('Código de vínculo', False);
  PaginaVinculo.Values[0] := 'localhost:8443';
  PaginaVinculo.Values[1] := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PaginaVinculo.ID then begin
    if not ServidorValido(ServidorInformado) then begin
      MsgBox('O servidor deve estar no formato HOST:PORTA, sem https:// e sem caminho.' + #13#10#13#10 + 'Exemplo para o ambiente local: localhost:8443', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not CodigoValido(CodigoInformado) then begin
      MsgBox('O código de vínculo deve estar no formato BLT-XXXX-XXXX-XXXX.' + #13#10#13#10 + 'Gere o código no Baluarte, na tela de ativos, e cole aqui.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

{ Resumo da pagina "Pronto para instalar". }
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  Ca: String;
begin
  if FileExists(ExpandConstant('{src}\recursos\ca.crt')) then
    Ca := 'CA local do Baluarte (ca.crt)'
  else
    Ca := 'autoridades públicas do pacote do osquery';
  Result := MemoDirInfo + NewLine + NewLine + 'Servidor:' + NewLine + Space + ServidorInformado + NewLine + NewLine + 'Código de vínculo:' + NewLine + Space + CodigoInformado + NewLine + NewLine + 'Agente:' + NewLine + Space + 'osquery {#OsqueryVersao} (MSI oficial, hash e assinatura conferidos)' + NewLine + Space + 'Serviço "osqueryd", início automático' + NewLine + Space + 'Confiança: ' + Ca;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Resultado: Integer;
  Parametros, ArqCodigo, ArqLog, PowerShell: String;
begin
  if CurStep <> ssPostInstall then Exit;

  ArqCodigo := ExpandConstant('{tmp}\vinculo.txt');
  ArqLog := ExpandConstant('{app}\instalacao.log');
  PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');

  { O codigo vai por arquivo, nunca na linha de comando: linha de comando de processo e visivel
    para qualquer usuario da maquina. O aplicar.ps1 sobrescreve e apaga o arquivo no fim. }
  if not SaveStringToFile(ArqCodigo, CodigoInformado, False) then begin
    Falhou := True;
    MsgBox('Não foi possível preparar o código de vínculo para a instalação.', mbCriticalError, MB_OK);
    Exit;
  end;

  Parametros := '-ExecutionPolicy Bypass -NoProfile -NonInteractive -File "' + ExpandConstant('{app}\aplicar.ps1') + '"' + ' -Servidor "' + ServidorInformado + '"' + ' -ArquivoCodigo "' + ArqCodigo + '"' + ' -Msi "' + ExpandConstant('{app}\{#OsqueryMsi}') + '"' + ' -Log "' + ArqLog + '"';
  if FileExists(ExpandConstant('{app}\ca.crt')) then
    Parametros := Parametros + ' -CaCert "' + ExpandConstant('{app}\ca.crt') + '"';

  WizardForm.StatusLabel.Caption := 'Instalando o osquery e configurando o serviço...';
  WizardForm.Refresh();

  if not Exec(PowerShell, Parametros, '', SW_HIDE, ewWaitUntilTerminated, Resultado) then begin
    Falhou := True;
    MsgBox('Não foi possível executar a configuração do agente.', mbCriticalError, MB_OK);
  end else if Resultado <> 0 then begin
    Falhou := True;
    MsgBox('O osquery foi copiado, mas a configuração do agente falhou.' + #13#10#13#10 + 'O diário da instalação está em:' + #13#10 + ArqLog + #13#10#13#10 + 'Causas comuns: o código de vínculo já foi usado ou expirou, ou o servidor ' + ServidorInformado + ' não está respondendo.', mbError, MB_OK);
  end;

  DeleteFile(ArqCodigo);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID <> wpFinished then Exit;
  if Falhou then
    WizardForm.FinishedLabel.Caption := 'A instalação terminou com erros e o agente pode não estar coletando.' + #13#10#13#10 + 'Veja o diário em ' + ExpandConstant('{app}\instalacao.log') + ' e, depois de corrigir, execute este instalador de novo com um código de vínculo novo.'
  else
    { Cuidado: daqui NAO da para afirmar que a estacao se inscreveu. A inscricao acontece quando
      o osqueryd sobe, depois que o instalar-agente.ps1 termina, e o que foi conferido ate aqui e
      so que o servico esta em execucao. Codigo errado ou expirado da exatamente este mesmo
      caminho: servico de pe, inscricao recusada com 401 e nada no painel. Por isso o texto manda
      conferir no painel em vez de dizer que deu certo. }
    WizardForm.FinishedLabel.Caption := 'O Agente Baluarte está instalado e o serviço do Windows está em execução.' + #13#10#13#10 + 'Confirme no painel do Baluarte, em Estações: a máquina deve aparecer em até um minuto, e o inventário técnico chega no primeiro ciclo de coleta.' + #13#10#13#10 + 'Se ela não aparecer, o código de vínculo provavelmente estava expirado ou já tinha sido usado. Gere um novo no painel e execute este instalador de novo.';
end;
