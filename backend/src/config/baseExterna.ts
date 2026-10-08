// Chamada HTTP as bases publicas de vulnerabilidades (OSV e NVD, B14). So faz o transporte:
// tempo limite, status e JSON. O que a resposta significa fica no service do cruzamento.
// A URL base de cada base vem do ambiente (OSV_API_URL, NVD_API_URL), para os testes usarem um
// servidor falso local; nada de rede real nos testes.

/** A base nao respondeu (fora do ar, sem rede, tempo esgotado, limite de requisicoes, 5xx). */
export class BaseIndisponivel extends Error {
  constructor(
    readonly base: 'OSV' | 'NVD',
    mensagem: string,
    /** Status HTTP, quando houve resposta. */
    readonly status?: number,
  ) {
    super(`${base}: ${mensagem}`);
  }
}

/** Tempo limite de cada requisicao (VULN_TIMEOUT_MS, padrao 15 s). */
export function tempoLimiteMs(): number {
  const ms = Number(process.env.VULN_TIMEOUT_MS);
  return Number.isInteger(ms) && ms > 0 ? ms : 15_000;
}

/**
 * Faz a requisicao e devolve o JSON; `null` quando a base responde 404 (registro ou produto
 * inexistente, que nao e falha). Qualquer outra resposta fora de 2xx, corpo que nao e JSON,
 * erro de rede ou tempo esgotado vira BaseIndisponivel.
 */
export async function obterJson(base: 'OSV' | 'NVD', url: string, init: RequestInit = {}): Promise<unknown | null> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { ...init, signal: AbortSignal.timeout(tempoLimiteMs()) });
  } catch (e) {
    const motivo = e instanceof Error && e.name === 'TimeoutError' ? 'tempo esgotado' : e instanceof Error ? e.message : String(e);
    throw new BaseIndisponivel(base, motivo);
  }
  if (resposta.status === 404) {
    await resposta.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!resposta.ok) {
    await resposta.body?.cancel().catch(() => undefined);
    throw new BaseIndisponivel(base, `respondeu ${resposta.status}`, resposta.status);
  }
  try {
    return await resposta.json();
  } catch {
    throw new BaseIndisponivel(base, 'resposta que não é JSON', resposta.status);
  }
}
