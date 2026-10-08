// Regras YARA proprias do Baluarte (B23) - carga escondida em base64 grande.
//
// Dois formatos que chegam por e-mail e escapam de filtro de extensao:
//  - atalho do Windows (.lnk) cujo destino e o PowerShell, com o comando em base64;
//  - HTML "contrabandeado" (HTML smuggling): a pagina remonta um arquivo a partir de um bloco
//    base64 grande com atob()/Blob e o entrega como download, sem o arquivo passar pelo filtro.
//
// O tamanho minimo do bloco (400 caracteres no .lnk, 2000 no HTML) evita marcar imagens
// pequenas embutidas e textos comuns. Imagem grande em data: URI nao basta: no HTML a regra
// exige tambem a remontagem (atob/Blob/download).
//
// Deteccoes: YARA.BaluarteLnkPayloadBase64.UNOFFICIAL e YARA.BaluarteHtmlPayloadBase64.UNOFFICIAL

rule BaluarteLnkPayloadBase64
{
    meta:
        autor = "Baluarte"
        descricao = "Atalho .lnk que chama o PowerShell com comando longo em base64"

    strings:
        // cabecalho do formato Shell Link (tamanho 0x4C + CLSID 00021401-0000-0000-C000-000000000046)
        $lnk = { 4C 00 00 00 01 14 02 00 00 00 00 00 C0 00 00 00 00 00 00 46 }
        // os argumentos do atalho ficam em UTF-16 (wide)
        $powershell = "powershell" nocase wide
        // O ClamAV nao aceita o modificador `wide` em expressao regular (a regra inteira e
        // descartada com aviso no log), entao o UTF-16 vai escrito na mao: caractere + byte zero.
        $base64 = /([A-Za-z0-9+\/]\x00){400}/

    condition:
        $lnk at 0 and $powershell and $base64
}

rule BaluarteHtmlPayloadBase64
{
    meta:
        autor = "Baluarte"
        descricao = "HTML que remonta um arquivo a partir de base64 grande (HTML smuggling)"

    strings:
        $html = "<html" nocase
        $remonta1 = "atob(" nocase
        $remonta2 = "new Blob" nocase
        $remonta3 = "msSaveOrOpenBlob" nocase
        $base64 = /[A-Za-z0-9+\/]{2000}/

    condition:
        $html and any of ($remonta*) and $base64
}
