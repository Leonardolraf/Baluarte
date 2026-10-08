// Cliente da API v3 do VirusTotal (B20): segunda opiniao sobre um arquivo ja analisado pelo
// ClamAV, consultada SO PELO SHA-256 (GET /files/{sha256}, cabecalho x-apikey). O arquivo nunca
// e enviado: este modulo nao conhece o endpoint de upload e so recebe o hash.
// Chave em VIRUSTOTAL_API_KEY (so no .env); sem ela a segunda opiniao fica desligada.
// VIRUSTOTAL_API_URL troca o endereco (testes usam um servidor HTTP local no lugar).
// A cota gratuita (4 por minuto, 500 por dia) e controlada no service, no banco.

/** Contagens de `last_analysis_stats` que entram no veredito. */
export interface Estatisticas {
  malicious: number;
  suspicious: number;
  undetected: number;
  harmless: number;
}

export type MotivoIndisponivel = 'CHAVE_INVALIDA' | 'LIMITE_VIRUSTOTAL' | 'TEMPO_ESGOTADO' | 'FALHA';

export type RespostaVirusTotal =
  | { tipo: 'RELATORIO'; estatisticas: Estatisticas }
  | { tipo: 'DESCONHECIDO' } // 404: o VirusTotal nao tem relatorio deste hash
  | { tipo: 'INDISPONIVEL'; motivo: MotivoIndisponivel };

const URL_PADRAO = 'https://www.virustotal.com/api/v3';
const SHA256 = /^[0-9a-f]{64}$/;

export function virusTotalConfigurado(): boolean {
  return Boolean(process.env.VIRUSTOTAL_API_KEY);
}

function tempoLimite(): number {
  const ms = Number(process.env.VIRUSTOTAL_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 8000;
}

const contagem = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** Le `data.attributes.last_analysis_stats`; formato inesperado devolve null. */
export function lerEstatisticas(corpo: unknown): Estatisticas | null {
  const stats = (corpo as { data?: { attributes?: { last_analysis_stats?: Record<string, unknown> } } } | null)
    ?.data?.attributes?.last_analysis_stats;
  if (!stats || typeof stats !== 'object') return null;
  const malicious = contagem(stats.malicious);
  const suspicious = contagem(stats.suspicious);
  const undetected = contagem(stats.undetected);
  const harmless = contagem(stats.harmless);
  if (malicious === null || suspicious === null || undetected === null || harmless === null) return null;
  return { malicious, suspicious, undetected, harmless };
}

/** O log leva so o status e o codigo de erro do VirusTotal: nunca a chave. */
function registrar(texto: string): void {
  console.error(`[virustotal] ${texto}`);
}

/**
 * Consulta o relatorio de um SHA-256. Nunca lanca: qualquer falha vira INDISPONIVEL, para a
 * analise do ClamAV seguir normal. Chame so com a chave configurada.
 */
export async function consultarHash(sha256: string): Promise<RespostaVirusTotal> {
  const chave = process.env.VIRUSTOTAL_API_KEY;
  if (!chave || !SHA256.test(sha256)) return { tipo: 'INDISPONIVEL', motivo: 'FALHA' };
  const base = (process.env.VIRUSTOTAL_API_URL ?? URL_PADRAO).replace(/\/+$/, '');
  try {
    const resposta = await fetch(`${base}/files/${sha256}`, {
      method: 'GET',
      headers: { 'x-apikey': chave, accept: 'application/json' },
      // Redirecionamento levaria o cabecalho com a chave para outro endereco: recusa.
      redirect: 'error',
      signal: AbortSignal.timeout(tempoLimite()),
    });
    if (resposta.status === 404) {
      await resposta.body?.cancel();
      return { tipo: 'DESCONHECIDO' };
    }
    if (!resposta.ok) {
      const codigo = ((await resposta.json().catch(() => ({}))) as { error?: { code?: unknown } }).error?.code;
      registrar(`respondeu ${resposta.status}${typeof codigo === 'string' ? ` ${codigo.slice(0, 60)}` : ''}`);
      if (resposta.status === 401 || resposta.status === 403) return { tipo: 'INDISPONIVEL', motivo: 'CHAVE_INVALIDA' };
      if (resposta.status === 429) return { tipo: 'INDISPONIVEL', motivo: 'LIMITE_VIRUSTOTAL' };
      return { tipo: 'INDISPONIVEL', motivo: 'FALHA' };
    }
    const estatisticas = lerEstatisticas(await resposta.json());
    if (!estatisticas) {
      registrar('resposta sem last_analysis_stats');
      return { tipo: 'INDISPONIVEL', motivo: 'FALHA' };
    }
    return { tipo: 'RELATORIO', estatisticas };
  } catch (e) {
    const nome = e instanceof Error ? e.name : '';
    if (nome === 'TimeoutError' || nome === 'AbortError') {
      registrar('tempo esgotado');
      return { tipo: 'INDISPONIVEL', motivo: 'TEMPO_ESGOTADO' };
    }
    // Erro de rede: a mensagem do fetch nao contem cabecalhos, mas so o nome vai para o log.
    registrar(`falha de rede (${nome || 'erro'})`);
    return { tipo: 'INDISPONIVEL', motivo: 'FALHA' };
  }
}
