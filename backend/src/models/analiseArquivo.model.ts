import type { FileScan } from '@prisma/client';

// Analise de arquivo pelo antivirus (B04). O arquivo nunca e gravado: passa em fluxo pelo
// ClamAV e e descartado; fica so o registro (nome para exibir, tamanho, SHA-256, veredito).

export type AnaliseArquivo = FileScan;

/** Tamanho maximo aceito por arquivo (o mesmo que a tela barra antes de enviar). */
export const LIMITE_ARQUIVO_BYTES = 10 * 1024 * 1024;

/** Analises por usuario por hora (o antivirus e caro: cada envio ocupa o clamd). */
export const LIMITE_ANALISES_POR_HORA = 20;

/** Campo do formulario multipart que leva o arquivo. */
export const CAMPO_ARQUIVO = 'arquivo';

/** O resultado diz o que o antivirus sabe: ameaca CONHECIDA. Nunca afirma "arquivo seguro". */
export const MENSAGEM_LIMPO = 'Nenhuma ameaça conhecida encontrada';
export const mensagemAmeaca = (ameaca: string) => `Ameaça encontrada: ${ameaca}`;

/** Analise como a API devolve. `usuario` so aparece para Administrador/Analista. */
export interface AnaliseDto {
  id: string;
  nome: string;
  tamanho: number;
  sha256: string;
  resultado: 'LIMPO' | 'AMEACA';
  ameaca: string | null;
  analisadoEm: Date;
  usuario?: { nome: string; email: string };
}

/**
 * Nome so para exibir: sem caminho (fica o ultimo trecho depois de / ou \), sem caracteres de
 * controle, ate 255 caracteres. Nunca e usado como caminho de arquivo.
 */
export function nomeParaExibir(original: string | undefined): string {
  const base = (original ?? '').split(/[\\/]/).pop() ?? '';
  const limpo = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return limpo || 'arquivo-sem-nome';
}
