// Regras YARA proprias do Baluarte (B23) - macro VBA suspeita em documento Office.
//
// O ataque mais comum por anexo numa empresa: um .doc/.xls com macro que roda sozinha ao abrir
// (AutoOpen, Document_Open, Workbook_Open) e chama o sistema (Shell, CreateObject,
// WScript.Shell) para baixar ou executar algo. O ClamAV extrai o projeto VBA de documentos
// OLE2 e OOXML e aplica as regras tambem sobre o codigo extraido, entao a regra procura o par
// "gatilho automatico + chamada ao sistema" no texto da macro.
//
// E sinal de SUSPEITA, nao prova: ha planilhas legitimas com macro automatica que chamam
// CreateObject. Por isso o veredito aparece como "regra propria do Baluarte" e pede revisao.
//
// Deteccao: YARA.BaluarteMacroSuspeita.UNOFFICIAL

rule BaluarteMacroSuspeita
{
    meta:
        autor = "Baluarte"
        descricao = "Macro VBA que executa ao abrir o documento e chama o sistema"

    strings:
        // gatilhos que rodam a macro sem o usuario clicar em nada alem de "Habilitar conteudo"
        $gatilho1 = "AutoOpen" nocase
        $gatilho2 = "Auto_Open" nocase
        $gatilho3 = "Document_Open" nocase
        $gatilho4 = "Workbook_Open" nocase
        $gatilho5 = "AutoExec" nocase

        // chamadas que saem do documento para o sistema operacional
        $sistema1 = "CreateObject" nocase
        $sistema2 = "WScript.Shell" nocase
        $sistema3 = "Shell(" nocase
        $sistema4 = "Shell.Application" nocase

    condition:
        any of ($gatilho*) and any of ($sistema*)
}
