import { isHttpError, errorMessage } from '@/lib/errors';
import type { FileScan, SecondOpinion, SecondOpinionReason } from '@/types';

// -----------------------------------------------------------------------------
// Análise de arquivos (B05): limite de envio, formatação de tamanho e as
// mensagens que a tela mostra para cada erro do contrato do B04.
// -----------------------------------------------------------------------------

/**
 * Limite da API (B04, LIMITE_ARQUIVO_BYTES no backend): 250 MB de 1024 × 1024 bytes. A tela barra
 * antes de enviar; a API responde 413 ARQUIVO_MUITO_GRANDE acima disso.
 */
export const MAX_FILE_SIZE_MB = 250;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = `${MAX_FILE_SIZE_MB} MB`;

/**
 * Tempo do envio no navegador (decisão do Leo, Melhorias #18): como no servidor, o envio não tem
 * prazo total, só de OCIOSIDADE. 250 MB numa conexão lenta porém estável podem levar o tempo que
 * for; sem progresso por 90 s (o servidor desiste em 60 s, então normalmente quem responde é a
 * API, com 408 ENVIO_PARADO) a tela desiste. Depois do último byte, espera a análise por até
 * 6 min (o antivírus tem até 5 min na API, CLAMAV_TIMEOUT_MS).
 */
export const UPLOAD_IDLE_TIMEOUT_MS = 90_000;
export const SCAN_RESPONSE_TIMEOUT_MS = 6 * 60_000;

/** Motivo da desistência do vigia de envio. */
export type UploadAbortReason = 'idle' | 'response';

/**
 * Vigia do envio: chama `onExpire` se o progresso parar por `idleMs` durante o envio ou se a
 * resposta não vier em `responseMs` depois do último byte. `progress` recebe o `onUploadProgress`
 * do axios; `stop` encerra o vigia (resposta chegou ou deu erro).
 */
export function watchUpload(
  onExpire: (reason: UploadAbortReason) => void,
  { idleMs = UPLOAD_IDLE_TIMEOUT_MS, responseMs = SCAN_RESPONSE_TIMEOUT_MS } = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = false;
  const arm = (ms: number, reason: UploadAbortReason) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onExpire(reason);
    }, ms);
  };
  arm(idleMs, 'idle');
  return {
    progress(loaded: number, total: number | undefined) {
      if (sent) return;
      if (total !== undefined && loaded >= total) {
        sent = true;
        arm(responseMs, 'response');
      } else {
        arm(idleMs, 'idle');
      }
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

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

export const FILE_TOO_LARGE_MESSAGE = `O arquivo passa do limite de ${MAX_FILE_SIZE_LABEL}. Escolha um arquivo menor.`;

/**
 * 413 sem o código da API: quem recusou foi a hospedagem, antes de a API ler o arquivo (ex.: a
 * função serverless da Vercel, que só aceita corpos de poucos MB). O limite de 250 MB não se
 * aplica ali, então a mensagem não o repete.
 */
export const HOST_TOO_LARGE_MESSAGE =
  'Este ambiente recusou o envio pelo tamanho antes da análise (o limite da hospedagem é menor que o da plataforma). Tente um arquivo menor ou fale com a equipe de segurança.';

/** Mensagem clara para cada erro do contrato de POST /arquivos/analise. */
export function fileScanErrorMessage(error: unknown): string {
  if (isHttpError(error)) {
    if (error.code === 'ARQUIVO_OBRIGATORIO')
      return 'Nenhum arquivo chegou ao servidor. Escolha um arquivo e tente de novo.';
    if (error.code === 'ARQUIVO_MUITO_GRANDE') return FILE_TOO_LARGE_MESSAGE;
    if (error.status === 413) return HOST_TOO_LARGE_MESSAGE;
    if (error.code === 'ENVIO_PARADO' || error.code === 'ENVIO_SEM_PROGRESSO')
      return 'O envio parou de avançar (conexão instável ou interrompida). Verifique a conexão e tente de novo.';
    if (error.code === 'ANALISE_SEM_RESPOSTA')
      return 'O arquivo chegou, mas a análise não respondeu a tempo. Tente de novo em alguns minutos.';
    // B23: anexo de campanha (antes do 429 genérico: o teto por campanha também é 429).
    if (error.code === 'CAMPANHA_NAO_RECEBIDA' || error.code === 'EVENTO_CAMPANHA_INVALIDO')
      return 'Essa campanha não está entre as que você recebeu. Escolha outra ou envie o arquivo sem campanha.';
    if (error.code === 'LIMITE_ANEXOS_CAMPANHA')
      return `Você já enviou ${MAX_ATTACHMENTS_PER_CAMPAIGN} anexos desta campanha. Se recebeu mais, fale com a equipe de segurança.`;
    if (error.status === 429 || error.code === 'MUITAS_ANALISES')
      return 'Você atingiu o limite de análises por hora. Aguarde um pouco e tente de novo.';
    if (error.status === 503 || error.code === 'ANTIVIRUS_INDISPONIVEL')
      return 'A análise de arquivos não está disponível neste ambiente: o antivírus não está ativo. Fale com a equipe de segurança.';
  }
  return errorMessage(error, 'Não foi possível analisar o arquivo. Tente de novo.');
}

/** Veredito em uma linha (lista de análises e anúncio para leitores de tela). */
export function fileScanVerdict(scan: Pick<FileScan, 'result' | 'threat'>): string {
  if (scan.result !== 'threat') return CLEAN_VERDICT;
  const verdict = `Ameaça encontrada: ${scan.threat ?? 'não identificada'}`;
  if (isOwnRule(scan.threat)) return `${verdict} (${OWN_RULE_LABEL})`;
  if (isLimitExceeded(scan.threat)) return `${verdict} (${LIMIT_EXCEEDED_LABEL})`;
  return verdict;
}

// ---- Regras YARA próprias e anexo de campanha (B23) --------------------------

/** Rótulo da detecção que veio de uma regra YARA própria do Baluarte (antivirus/regras). */
export const OWN_RULE_LABEL = 'regra própria do Baluarte';

/**
 * O ClamAV nomeia a detecção de regra YARA como `YARA.<regra>.UNOFFICIAL`; as do Baluarte começam
 * com `Baluarte`. Mesma regra do backend (`ehRegraPropria`): YARA de terceiros não ganha o rótulo.
 */
export function isOwnRule(threat: string | null | undefined): boolean {
  return typeof threat === 'string' && /^YARA\.Baluarte[A-Za-z0-9_]*\.UNOFFICIAL$/.test(threat);
}

/**
 * `Heuristics.Limits.Exceeded.<Limite>`: o antivírus não conseguiu analisar o arquivo inteiro
 * (tamanho, compactado grande ou fundo demais) e, por precaução, isso conta como ameaça. Mesma
 * regra do backend (`ehLimiteExcedido`).
 */
export function isLimitExceeded(threat: string | null | undefined): boolean {
  return typeof threat === 'string' && /^Heuristics\.Limits\.Exceeded(\.[A-Za-z0-9_]+)?$/.test(threat);
}

export const LIMIT_EXCEEDED_LABEL =
  'passa dos limites de análise do antivírus; tratado como ameaça por precaução';

/** Anexos por destinatário em cada campanha (o mesmo teto do backend). */
export const MAX_ATTACHMENTS_PER_CAMPAIGN = 5;

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
