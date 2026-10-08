import { isHttpError, errorMessage } from '@/lib/errors';
import type { FileScan } from '@/types';

// -----------------------------------------------------------------------------
// Análise de arquivos (B05): limite de envio, formatação de tamanho e as
// mensagens que a tela mostra para cada erro do contrato do B04.
// -----------------------------------------------------------------------------

/** Limite do contrato (B04): 10 MB. A tela barra antes de enviar; a API responde 413 acima disso. */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Veredito sem ameaça. Nunca "arquivo seguro": o antivírus só conhece assinaturas já catalogadas. */
export const CLEAN_VERDICT = 'Nenhuma ameaça conhecida encontrada';

export function isTooLarge(size: number): boolean {
  return size > MAX_FILE_SIZE_BYTES;
}

/** Tamanho legível em pt-BR, base 1024 (KB, MB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[unit]}`;
}

export const FILE_TOO_LARGE_MESSAGE = 'O arquivo passa do limite de 10 MB. Escolha um arquivo menor.';

/** Mensagem clara para cada erro do contrato de POST /arquivos/analise. */
export function fileScanErrorMessage(error: unknown): string {
  if (isHttpError(error)) {
    if (error.code === 'ARQUIVO_OBRIGATORIO')
      return 'Nenhum arquivo chegou ao servidor. Escolha um arquivo e tente de novo.';
    if (error.status === 413 || error.code === 'ARQUIVO_MUITO_GRANDE') return FILE_TOO_LARGE_MESSAGE;
    if (error.status === 429 || error.code === 'MUITAS_ANALISES')
      return 'Você atingiu o limite de análises por hora. Aguarde um pouco e tente de novo.';
    if (error.status === 503 || error.code === 'ANTIVIRUS_INDISPONIVEL')
      return 'A análise de arquivos não está disponível neste ambiente: o antivírus não está ativo. Fale com a equipe de segurança.';
  }
  return errorMessage(error, 'Não foi possível analisar o arquivo. Tente de novo.');
}

/** Veredito em uma linha (lista de análises e anúncio para leitores de tela). */
export function fileScanVerdict(scan: Pick<FileScan, 'result' | 'threat'>): string {
  return scan.result === 'threat' ? `Ameaça encontrada: ${scan.threat ?? 'não identificada'}` : CLEAN_VERDICT;
}
