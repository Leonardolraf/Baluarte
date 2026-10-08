// Regras YARA proprias do Baluarte (B23) - marcador de teste.
//
// Analogo ao EICAR, mas do Baluarte: uma frase inofensiva que so existe para demonstrar que o
// ClamAV carregou as regras proprias. Qualquer arquivo de texto com a frase abaixo e marcado
// como YARA.BaluarteMarcadorTeste.UNOFFICIAL. Nao ha nada executavel aqui.
//
// Para a demonstracao: crie um .txt com a linha
//   BALUARTE-TESTE-AMEACA-0001-ARQUIVO-INOFENSIVO
// e envie na tela /files.
//
// Limites do ClamAV (docs.clamav.net, "YARA Rules"): sem modulos (import), sem regras
// globais, sem variaveis externas, no maximo 64 strings por regra, cada string com pelo menos
// 2 bytes e pelo menos uma string por regra (a condicao e disparada por casamento de string).
// Testado no ClamAV 1.5: o modificador `wide` nao vale para expressao regular (a regra e
// descartada com o aviso "clamav cannot support 1 input strings"), e regra com erro de sintaxe
// tambem so gera aviso ("failed to parse or load"): o clamd sobe sem ela, em silencio para a
// API. Confira cada regra nova com clamscan antes de usar (ver README).

rule BaluarteMarcadorTeste
{
    meta:
        autor = "Baluarte"
        descricao = "Marcador de teste do Baluarte (inofensivo, para demonstracao)"

    strings:
        $marcador = "BALUARTE-TESTE-AMEACA-0001-ARQUIVO-INOFENSIVO"

    condition:
        $marcador
}
