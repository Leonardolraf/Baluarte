import { BaseIndisponivel, obterJson } from './baseExterna.js';

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

/**
 * Faz a consulta. No NVD, "nenhum resultado" e sempre 200 com lista vazia (produto ou CVE
 * inexistente inclusive); 404 so vem de requisicao recusada (chave invalida ou parametro
 * malformado). Por isso 404 e FALHA da base, nunca "nenhuma vulnerabilidade": senao uma chave
 * revogada faria toda estacao Windows parecer limpa (DT22, conferido na API publica em 11/10/2026).
 */
async function consultar(parametros: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(parametros).toString();
  const json = await obterJson('NVD', `${urlBase()}/rest/json/cves/2.0?${qs}`, { headers: cabecalhos() });
  if (json === null) throw new BaseIndisponivel('NVD', 'respondeu 404: requisição recusada (chave ou parâmetro inválido)', 404);
  return json;
}

/** Tamanho da pagina; NVD_RESULTADOS_POR_PAGINA so existe para os testes paginarem com pouco dado. */
export function resultadosPorPagina(): number {
  const n = Number(process.env.NVD_RESULTADOS_POR_PAGINA);
  return Number.isInteger(n) && n > 0 && n <= RESULTADOS_POR_PAGINA ? n : RESULTADOS_POR_PAGINA;
}

/**
 * Uma pagina dos CVEs que afetam o CPE, a partir de `inicio` (startIndex). Quem pagina e o
 * service (cada pagina conta no orcamento do NVD).
 */
export function cvesPorCpe(cpe: string, inicio = 0): Promise<unknown> {
  return consultar({ cpeName: cpe, resultsPerPage: String(resultadosPorPagina()), startIndex: String(inicio) });
}

/** Um CVE pelo identificador (CVE inexistente: 200 com lista vazia). */
export function cvePorId(cve: string): Promise<unknown> {
  return consultar({ cveId: cve });
}
