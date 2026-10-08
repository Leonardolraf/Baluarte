import { isHttpError, errorMessage } from '@/lib/errors';
import type { FileScan, SecondOpinion, SecondOpinionReason } from '@/types';

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

// ---- Segunda opinião do VirusTotal (B20) -------------------------------------

const REASON_TEXT: Record<SecondOpinionReason, string> = {
  quota: 'cota',
  invalid_key: 'chave do VirusTotal recusada',
  provider_limit: 'limite do VirusTotal',
  timeout: 'o VirusTotal não respondeu a tempo',
  failure: 'falha ao consultar o VirusTotal',
};

export interface SecondOpinionText {
  /** Linha principal (cartão do resultado e anúncio para leitores de tela). */
  title: string;
  /** O que isso quer dizer para quem vai abrir o arquivo. */
  detail: string;
  /** Rótulo curto para o histórico. */
  short: string;
}

/**
 * Textos da segunda opinião. Como no veredito do antivírus, nunca dizem "seguro": sem detecção
 * e "desconhecido" não provam que o arquivo é confiável.
 */
export function secondOpinionText(opinion: SecondOpinion): SecondOpinionText {
  const counts = `${opinion.detections ?? 0}/${opinion.total ?? 0}`;
  switch (opinion.status) {
    case 'malicious':
      return {
        title: `${opinion.detections} de ${opinion.total} antivírus do VirusTotal detectaram este arquivo`,
        detail:
          'O veredito acima é do antivírus da plataforma e não muda, mas trate o arquivo como perigoso: não o abra e avise a equipe de segurança.',
        short: `${counts} detecções`,
      };
    case 'suspicious':
      return {
        title: `${opinion.detections} de ${opinion.total} antivírus do VirusTotal marcaram este arquivo como suspeito`,
        detail:
          'Confirme a origem do arquivo com quem o enviou antes de abrir e, na dúvida, fale com a equipe de segurança.',
        short: `${counts} suspeito`,
      };
    case 'no_detection':
      return {
        title: `Nenhum dos ${opinion.total} antivírus do VirusTotal detectou ameaça conhecida`,
        detail:
          'Isso também não prova que o arquivo é confiável: na dúvida, confirme a origem antes de abrir.',
        short: `${counts} detecções`,
      };
    case 'unknown':
      return {
        title: 'O VirusTotal não conhece este arquivo',
        detail:
          'Consultamos só o SHA-256 e não há relatório para ele. O arquivo não foi enviado ao VirusTotal. Arquivo desconhecido não é sinal de que ele é confiável.',
        short: 'Desconhecido',
      };
    case 'unavailable':
      return {
        title: `Segunda opinião indisponível agora (${REASON_TEXT[opinion.reason ?? 'failure']})`,
        detail:
          'O veredito do antivírus acima vale normalmente. Você pode analisar o arquivo de novo mais tarde ou abrir o relatório do hash no VirusTotal.',
        short: 'Indisponível',
      };
    default:
      return {
        title: 'Segunda opinião desligada neste ambiente',
        detail: 'Só o antivírus da plataforma analisou o arquivo.',
        short: 'Desligada',
      };
  }
}
