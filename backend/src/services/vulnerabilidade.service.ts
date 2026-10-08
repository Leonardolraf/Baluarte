import { falhar } from '../utils/resposta.js';
import { STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
import { lerRemediacao } from '../models/catalogoAchado.model.js';
import { avancarVarreduras } from './cicloVarredura.service.js';
import { faixaCvss } from './cvss.service.js';
import * as repo from '../repositories/vulnerabilidade.repository.js';
import type { FiltrosVulnerabilidade, FindingComScan } from '../models/vulnerabilidade.model.js';

// Vulnerabilidades (achados das varreduras): lista com filtros, detalhe, mudanca de status
// e a classificacao CVSS publica do contrato.

/** "Resolvida" e "Risco aceito" saem dos KPIs, dos alertas e das listas de recentes. */
export function encerrado(f: { status: string }): boolean {
  return STATUS_FINDING_ENCERRADO.includes(f.status);
}

/** Achado como a API devolve (campos em portugues, remediacao numerada). */
export function mapFinding(f: FindingComScan) {
  return {
    id: f.id,
    ativo: f.scan.asset.host,
    ativoNome: f.scan.asset.nome,
    categoria: f.categoriaOwasp,
    cvss: f.cvss,
    cvssVetor: f.cvssVetor,
    cwe: f.cwe,
    cve: f.cve,
    severidade: f.severidade,
    status: f.status,
    descricao: f.descricao,
    evidencia: f.evidencia,
    remediacao: lerRemediacao(f.remediacao),
    detectadoEm: f.criadoEm,
  };
}

/** Todos os achados (o status das varreduras avanca antes, na leitura). */
export async function todos(): Promise<FindingComScan[]> {
  await avancarVarreduras();
  return repo.listar();
}

export async function listar(filtros: FiltrosVulnerabilidade) {
  let findings = await todos();
  if (filtros.severidade) findings = findings.filter((f) => f.severidade.toLowerCase() === filtros.severidade!.toLowerCase());
  if (filtros.status) findings = findings.filter((f) => f.status.toLowerCase() === filtros.status!.toLowerCase());
  if (filtros.q) {
    const termo = filtros.q.toLowerCase();
    findings = findings.filter((f) => f.scan.asset.host.toLowerCase().includes(termo) || f.categoriaOwasp.toLowerCase().includes(termo));
  }
  const lista = findings.map(mapFinding);
  return { lista, resumo: { total: lista.length, ativos: new Set(findings.map((f) => f.scan.asset.host)).size } };
}

export async function detalhe(id: string) {
  const f = await repo.buscar(id);
  if (!f) falhar(404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
  return mapFinding(f);
}

export async function alterarStatus(id: string, status: string) {
  if (!(await repo.existe(id))) falhar(404, 'Vulnerabilidade não encontrada', 'FINDING_NAO_ENCONTRADO');
  return mapFinding(await repo.alterarStatus(id, status));
}

/** Classificacao publica do contrato: faixa de severidade de uma nota CVSS. */
export function classificar(cvss: number) {
  return { cvss, faixa: faixaCvss(cvss) };
}
