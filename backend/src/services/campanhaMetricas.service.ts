import type { EventoFunil } from '../models/campanha.model.js';

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

/** Enviados e clicados somados de todas as campanhas. */
export function totais(campanhas: { eventos: { enviadoEm: Date | null; clicadoEm: Date | null }[] }[]) {
  const enviados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.enviadoEm).length, 0);
  const clicados = campanhas.reduce((a, c) => a + c.eventos.filter((e) => e.clicadoEm).length, 0);
  return { enviados, clicados };
}
