import { obterJson } from './baseExterna.js';

// Cliente da API 2.0 de CVEs do NVD (https://nvd.nist.gov/developers/vulnerabilities).
//  - ?cpeName=<cpe>: CVEs que afetam aquele produto naquela versao (programas Windows, pela
//    tabela de CPE em models/tabelaCpe.model.ts).
//  - ?cveId=<CVE>: um CVE so (vetor CVSS de um CVE que o OSV trouxe sem nota).
// Limite publico: 5 requisicoes a cada 30 s sem chave e 50 com chave. A chave e opcional e vem
// SO do ambiente (NVD_API_KEY), no cabecalho `apiKey`; nunca vai para log nem para o codigo.
// NVD_API_URL troca o endereco (os testes apontam para um servidor falso local).

/** Maximo de CVEs por pagina que a API aceita. */
export const RESULTADOS_POR_PAGINA = 2000;

function urlBase(): string {
  return (process.env.NVD_API_URL ?? 'https://services.nvd.nist.gov').replace(/\/+$/, '');
}

export function temChave(): boolean {
  return Boolean(process.env.NVD_API_KEY?.trim());
}

function cabecalhos(): Record<string, string> {
  const chave = process.env.NVD_API_KEY?.trim();
  return { accept: 'application/json', ...(chave ? { apiKey: chave } : {}) };
}

function consultar(parametros: Record<string, string>): Promise<unknown | null> {
  const qs = new URLSearchParams(parametros).toString();
  return obterJson('NVD', `${urlBase()}/rest/json/cves/2.0?${qs}`, { headers: cabecalhos() });
}

/** CVEs que afetam o CPE (primeira pagina, ate 2000); null se o NVD responde 404. */
export function cvesPorCpe(cpe: string): Promise<unknown | null> {
  return consultar({ cpeName: cpe, resultsPerPage: String(RESULTADOS_POR_PAGINA) });
}

/** Um CVE pelo identificador; null se o NVD responde 404. */
export function cvePorId(cve: string): Promise<unknown | null> {
  return consultar({ cveId: cve });
}
