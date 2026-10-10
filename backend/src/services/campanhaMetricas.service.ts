import type { EventoFunil } from '../models/campanha.model.js';
import { PESO_RISCO_HUMANO } from '../models/dominio.model.js';

// Metricas de campanha usadas pelo relatorio, pela lista e pelo dashboard.

export function funilDe(eventos: EventoFunil[]) {
  const enviados = eventos.filter((e) => e.enviadoEm).length;
  const abertos = eventos.filter((e) => e.abertoEm).length;
  const clicados = eventos.filter((e) => e.clicadoEm).length;
  const submeteram = eventos.filter((e) => e.submeteuEm).length;
  const reportaram = eventos.filter((e) => e.reportouEm).length;
  const pct = (n: number) => (enviados ? Math.round((n / enviados) * 100) : 0);
  return {
    enviados: { valor: enviados, pct: 100 },
    abertos: { valor: abertos, pct: pct(abertos) },
    clicados: { valor: clicados, pct: pct(clicados) },
    submeteram: { valor: submeteram, pct: pct(submeteram) },
    reportaram: { valor: reportaram, pct: pct(reportaram) },
  };
}

export function mapCampaign(c: { id: string; nome: string; template: string; status: string; criadoEm: Date; eventos: { enviadoEm: Date | null; clicadoEm: Date | null }[] }) {
  const enviados = c.eventos.filter((e) => e.enviadoEm).length;
  const clicados = c.eventos.filter((e) => e.clicadoEm).length;
  return {
    id: c.id,
    nome: c.nome,
    template: c.template,
    status: c.status,
    destinatarios: c.eventos.length,
    taxaClique: enviados ? Math.round((clicados / enviados) * 100) : 0,
    criadoEm: c.criadoEm,
  };
}

/**
 * Pessoas distintas que clicaram e concluiram o treinamento em alguma campanha: a mesma regra
 * da lista de `GET /treinamentos/consolidado` (quem treinou em duas campanhas conta uma vez).
 */
export function colaboradoresTreinados(campanhas: { eventos: { userId: string; clicadoEm: Date | null; treinou: boolean }[] }[]) {
  const pessoas = new Set<string>();
  for (const c of campanhas) for (const e of c.eventos) if (e.clicadoEm && e.treinou) pessoas.add(e.userId);
  return pessoas.size;
}

/**
 * Risco humano 0–100 de todas as campanhas, com os pesos de PESO_RISCO_HUMANO sobre as taxas
 * de clique e de submissao (em % inteiros, como no funil). `null` sem envio: nao medido, nunca 0.
 */
export function riscoHumano(campanhas: { eventos: { enviadoEm: Date | null; clicadoEm: Date | null; submeteuEm: Date | null }[] }[]) {
  const eventos = campanhas.flatMap((c) => c.eventos);
  const enviados = eventos.filter((e) => e.enviadoEm).length;
  if (!enviados) return null;
  const pct = (n: number) => Math.round((n / enviados) * 100);
  const clique = pct(eventos.filter((e) => e.clicadoEm).length);
  const submissao = pct(eventos.filter((e) => e.submeteuEm).length);
  return Math.max(0, Math.min(100, Math.round(clique * PESO_RISCO_HUMANO.clique + submissao * PESO_RISCO_HUMANO.submissao)));
}

/** Enviados e clicados somados de todas as campanhas. */
export function totais(campanhas: { eventos: { enviadoEm: Date | null; clicadoEm: Date | null }[] }[]) {
  const enviados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.enviadoEm).length, 0);
  const clicados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.clicadoEm).length, 0);
  return { enviados, clicados };
}
