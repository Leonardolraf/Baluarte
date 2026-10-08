import { prisma } from '../config/db.js';
import { hashToken } from '../utils/tokens.js';

// Eventos de campanha vistos pelo lado do treinamento (clique, conclusao, reporte).

export function eventoPorId(id: string) {
  return prisma.campaignEvent.findUnique({ where: { id }, include: { campaign: true } });
}

/** Evento pelo token do link do e-mail: no banco fica so o hash. */
export function eventoPeloLink(token: string) {
  return prisma.campaignEvent.findUnique({ where: { tokenHash: hashToken(token.trim()) }, include: { campaign: true } });
}

export function marcarConcluido(id: string) {
  return prisma.campaignEvent.update({ where: { id }, data: { treinou: true, treinouEm: new Date() } });
}

export function marcarClique(id: string, agora: Date, abertoEm: Date) {
  return prisma.campaignEvent.update({ where: { id }, data: { clicadoEm: agora, abertoEm } });
}

/** Grava o reporte so se ainda nao havia (reportes simultaneos nao registram duas vezes). */
export async function marcarReporte(id: string, agora: Date, abertoEm: Date): Promise<boolean> {
  const { count } = await prisma.campaignEvent.updateMany({ where: { id, reportouEm: null }, data: { reportouEm: agora, abertoEm } });
  return count === 1;
}

export async function dataDoReporte(id: string) {
  return (await prisma.campaignEvent.findUniqueOrThrow({ where: { id } })).reportouEm;
}

/** Totais e conclusoes nominais de todas as campanhas (tela de treinamentos). */
export function consolidado() {
  return Promise.all([
    prisma.campaign.count(),
    prisma.campaignEvent.count({ where: { clicadoEm: { not: null } } }),
    prisma.campaignEvent.findMany({
      where: { clicadoEm: { not: null }, treinou: true },
      select: {
        campaign: { select: { id: true, nome: true } },
        user: { select: { id: true, nome: true, email: true, department: { select: { name: true } } } },
      },
    }),
  ]);
}
