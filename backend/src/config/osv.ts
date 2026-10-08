import { obterJson } from './baseExterna.js';

// Cliente do OSV (https://osv.dev), base aberta de vulnerabilidades que cobre os pacotes das
// distribuicoes Linux (Debian, Ubuntu, AlmaLinux, Rocky...). Sem chave nem limite publicado.
//  - POST /v1/querybatch: varios pacotes (nome, ecossistema, versao) numa requisicao; devolve,
//    na mesma ordem, so os ids das vulnerabilidades que afetam cada versao.
//  - GET /v1/vulns/{id}: o registro completo (aliases, CVE de origem, vetor CVSS, versao corrigida).
// OSV_API_URL troca o endereco (os testes apontam para um servidor falso local).

export interface ConsultaPacote {
  nome: string;
  ecossistema: string;
  versao: string;
}

function urlBase(): string {
  return (process.env.OSV_API_URL ?? 'https://api.osv.dev').replace(/\/+$/, '');
}

/** Corpo cru do querybatch (o service le e valida). */
export function consultarLote(consultas: ConsultaPacote[]): Promise<unknown | null> {
  return obterJson('OSV', `${urlBase()}/v1/querybatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      queries: consultas.map((c) => ({ package: { name: c.nome, ecosystem: c.ecossistema }, version: c.versao })),
    }),
  });
}

/** Registro completo de uma vulnerabilidade; null se o OSV nao a conhece (404). */
export function buscarVulnerabilidade(id: string): Promise<unknown | null> {
  return obterJson('OSV', `${urlBase()}/v1/vulns/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
}
