// Regras YARA proprias do Baluarte (B23) - PowerShell que baixa e executa.
//
// Padrao classico de anexo .ps1/.bat/.txt "de suporte": baixar um texto da internet e executa-lo
// na memoria (IEX + DownloadString), ou esconder o comando inteiro em base64
// (powershell -EncodedCommand). As duas formas sao raras em script legitimo de usuario comum.
//
// Deteccao: YARA.BaluartePowerShellBaixaExecuta.UNOFFICIAL

rule BaluartePowerShellBaixaExecuta
{
    meta:
        autor = "Baluarte"
        descricao = "PowerShell que baixa conteudo e o executa, ou que esconde o comando em base64"

    strings:
        // executar texto como codigo
        $executa1 = "IEX(" nocase
        $executa2 = "IEX (" nocase
        $executa3 = "| IEX" nocase
        $executa4 = "Invoke-Expression" nocase

        // baixar da internet
        $baixa1 = "DownloadString" nocase
        $baixa2 = "DownloadFile" nocase
        $baixa3 = "Net.WebClient" nocase
        $baixa4 = "Invoke-WebRequest" nocase

        // comando escondido em base64
        $powershell = "powershell" nocase
        $codificado1 = "-EncodedCommand" nocase
        $codificado2 = "-enc " nocase

    condition:
        (any of ($executa*) and any of ($baixa*)) or ($powershell and any of ($codificado*))
}
