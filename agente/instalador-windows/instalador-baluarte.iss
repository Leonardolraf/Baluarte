; Instalador do Agente Baluarte (melhoria #9) - Inno Setup 6
;
; Empacota o MSI OFICIAL do osquery + a configuracao do Baluarte num unico .exe, com um wizard
; de 6 passos. O trabalho de maquina NAO esta aqui: quem mexe na estacao e o
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
; Perfil do build (empacotar.ps1 -Servidor/-CaDescricao/-Sufixo): o servidor ja preenchido no
; wizard, como a CA embutida aparece no resumo e o sufixo do nome do .exe. Sem nada, o build local.
#ifndef ServidorPadrao
  #define ServidorPadrao "localhost:8443"
#endif
#ifndef CaDescricao
  #define CaDescricao "CA local do Baluarte (ca.crt)"
#endif
#ifndef SufixoSaida
  #define SufixoSaida ""
#endif

; Modo demonstracao (empacotar.ps1 -Demonstracao): o MESMO wizard, pelas mesmas 6 paginas, mas
; INCAPAZ de instalar. Serve para mostrar o fluxo numa maquina qualquer sem Docker, sem
; certificados, sem backend e sem administrador. O que muda: nao embute o MSI do osquery, nao
; chama o aplicar.ps1, nao pede elevacao, instala numa pasta temporaria do usuario e nao se
; registra em Aplicativos Instalados. Sai com DEMONSTRACAO no nome do arquivo, de proposito,
; para ninguem confundir com o instalador de verdade.
[Setup]
#ifdef Demonstracao
AppId={{7C2E9A14-5B3D-4F60-8E71-2A4C6D8B0F93}
OutputBaseFilename=InstaladorAgenteBaluarte-{#MinhaVersao}-DEMONSTRACAO
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Temp\BaluarteAgenteDemonstracao
Uninstallable=no
#else
AppId={{B4A1F7C2-6E3D-4A58-9C0B-1D7E2A9F5C34}
OutputBaseFilename=InstaladorAgenteBaluarte-{#MinhaVersao}{#SufixoSaida}
; O agente roda como servico do Windows e o MSI do osquery escreve em Program Files:
; sem administrador nao ha instalacao possivel.
PrivilegesRequired=admin
DefaultDirName={autopf}\Baluarte\Agente
UninstallDisplayName={#MeuNome}
UninstallDisplayIcon={app}\baluarte.ico
#endif
AppName={#MeuNome}
AppVersion={#MinhaVersao}
AppVerName={#MeuNome} {#MinhaVersao}
AppPublisher={#MinhaEmpresa}
VersionInfoDescription=Instalador do Agente de Monitoramento Baluarte
VersionInfoVersion={#MinhaVersao}
DefaultGroupName=Baluarte
DisableProgramGroupPage=yes
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=saida
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; As 6 paginas do wizard: boas-vindas, termos, servidor+codigo, pronto, instalando, concluido.
; Sem pagina de pasta (24/11/2026): o aplicar.ps1 roda ELEVADO a partir de {app}; numa pasta do
; usuario (Documentos, por exemplo), qualquer programa dele poderia trocar o script antes da
; execucao. Program Files so o administrador escreve. UsePreviousAppDir=no faz uma instalacao
; antiga noutra pasta nao ser reaproveitada.
DisableDirPage=yes
UsePreviousAppDir=no
; O Inno esconde a de boas-vindas no estilo moderno; aqui ela faz parte do fluxo.
DisableWelcomePage=no
LicenseFile=termos-instalacao.txt
; Marca: o escudo canonico do produto (baluarte-frontend\public\baluarte.svg), rasterizado por
; recursos\gerar-imagens.py. WizardImageFile e o painel das paginas de boas-vindas e conclusao;
; WizardSmallImageFile, o selo no alto das demais.
SetupIconFile=recursos\baluarte.ico
WizardImageFile=recursos\wizard-grande.bmp
WizardSmallImageFile=recursos\wizard-pequeno.bmp

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
#ifndef Demonstracao
; O MSI oficial do osquery, embutido para instalar sem internet (baixar-osquery.ps1).
Source: "recursos\{#OsqueryMsi}"; DestDir: "{app}"; Flags: ignoreversion
#endif
; A CA local do Baluarte (certs\ca.crt). Opcional: sem ela o agente so confia em autoridades
; publicas, o que nao serve para um servidor com certificado proprio.
Source: "recursos\ca.crt"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

#ifndef Demonstracao
[UninstallRun]
; Remove o servico e o osquery antes de apagar a pasta (o script nao recebe parametros).
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoProfile -NonInteractive -File ""{app}\desinstalar-agente.ps1"""; StatusMsg: "Removendo o serviço do agente..."; Flags: runhidden waituntilterminated; RunOnceId: "RemoverAgente"

[UninstallDelete]
Type: files; Name: "{app}\instalacao.log"
#endif

[Code]
const
  ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

var
  PaginaVinculo: TInputQueryWizardPage;
  Falhou: Boolean;
  { Saida do aplicar.ps1 depois da conferencia: 0 inscrita, 3 recusada, 4 nao confirmada. }
  Inscricao: Integer;

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
  PaginaVinculo.Values[0] := '{#ServidorPadrao}';
  PaginaVinculo.Values[1] := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PaginaVinculo.ID then begin
    if not ServidorValido(ServidorInformado) then begin
      MsgBox('O servidor deve estar no formato HOST:PORTA, sem https:// e sem caminho.' + #13#10#13#10 + 'Exemplo: {#ServidorPadrao}', mbError, MB_OK);
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
    Ca := '{#CaDescricao}'
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

#ifdef Demonstracao
  { Modo demonstracao: o wizard percorre as 6 paginas, mas NADA e instalado. Sem o MSI embutido,
    sem chamar o aplicar.ps1, sem servico. Sair aqui e o que garante isso. }
  Exit;
#endif

  { Variavel global comeca em 0, que aqui significa "inscrita": parte de "nao confirmada" para
    que nenhum caminho que pule o Exec mostre sucesso por omissao. }
  Inscricao := 4;
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

  WizardForm.StatusLabel.Caption := 'Instalando o osquery, configurando o serviço e conferindo a inscrição no Baluarte...';
  WizardForm.Refresh();

  if not Exec(PowerShell, Parametros, '', SW_HIDE, ewWaitUntilTerminated, Resultado) then begin
    Falhou := True;
    MsgBox('Não foi possível executar a configuração do agente.', mbCriticalError, MB_OK);
  end else if (Resultado = 0) or (Resultado = 3) or (Resultado = 4) then begin
    { Instalado e servico de pe; o que muda e o que a conferencia viu da inscricao. }
    Inscricao := Resultado;
  end else begin
    Falhou := True;
    MsgBox('O osquery foi copiado, mas a configuração do agente falhou.' + #13#10#13#10 + 'O diário da instalação está em:' + #13#10 + ArqLog + #13#10#13#10 + 'Causas comuns: o código de vínculo já foi usado ou expirou, ou o servidor ' + ServidorInformado + ' não está respondendo.', mbError, MB_OK);
  end;

  DeleteFile(ArqCodigo);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID <> wpFinished then Exit;
#ifdef Demonstracao
  WizardForm.FinishedLabel.Caption :=
    'Demonstração do instalador: nenhuma alteração foi feita neste computador.' + #13#10#13#10 +
    'No instalador real, a esta altura o osquery já estaria instalado, o serviço do Windows em execução e o código de vínculo gravado — e a orientação seria conferir a estação no painel do Baluarte.';
  Exit;
#endif
  if Falhou then
    WizardForm.FinishedLabel.Caption := 'A instalação terminou com erros e o agente pode não estar coletando.' + #13#10#13#10 + 'Veja o diário em ' + ExpandConstant('{app}\instalacao.log') + ' e, depois de corrigir, execute este instalador de novo com um código de vínculo novo.'
  { Servico em execucao NAO e estacao inscrita: o texto sai do que a conferencia do aplicar.ps1
    viu no console do osquery (ver ConferirInscricao), nunca so do servico estar de pe. }
  else if Inscricao = 0 then
    WizardForm.FinishedLabel.Caption := 'O Agente Baluarte está instalado e a estação foi inscrita no Baluarte: o servidor aceitou o código de vínculo e entregou a configuração.' + #13#10#13#10 + 'A máquina já aparece no painel, em Estações, vinculada ao ativo cadastrado. O inventário técnico chega no primeiro ciclo de coleta.'
  else if Inscricao = 3 then
    WizardForm.FinishedLabel.Caption := 'O osquery está instalado, mas o Baluarte RECUSOU o código de vínculo: ele expirou, já foi usado ou não existe.' + #13#10#13#10 + 'A estação não aparece no painel. Gere um código novo no Baluarte e execute este instalador de novo (não precisa desinstalar).' + #13#10#13#10 + 'Diário: ' + ExpandConstant('{app}\instalacao.log')
  else
    WizardForm.FinishedLabel.Caption := 'O osquery está instalado e o serviço do Windows está em execução, mas não foi possível confirmar a inscrição.' + #13#10#13#10 + 'Confira no painel do Baluarte, em Estações, se a máquina aparece em alguns minutos. Se não aparecer, verifique se o servidor ' + ServidorInformado + ' está no ar e veja o diário em ' + ExpandConstant('{app}\instalacao.log') + '.';
end;
