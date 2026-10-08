import { prisma } from '../config/db.js';

/** Usuarios pelos e-mails (citext: ignora maiusculas). */
export function usuariosPorEmail(emails: string[]) {
  return prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, nome: true, email: true, status: true } });
}

export function criar(dados: { nome: string; template: string }, eventos: { userId: string; destinatario: string; tokenHash: string }[]) {
  return prisma.campaign.create({ data: { ...dados, status: 'AGENDADA', eventos: { create: eventos } } });
}

export function listarComEventos() {
  return prisma.campaign.findMany({ include: { eventos: true }, orderBy: { criadoEm: 'desc' } });
}

/** Campanha com os eventos e o departamento ATUAL de cada destinatario. */
export function relatorio(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    include: { eventos: { include: { user: { select: { department: { select: { name: true } } } } } } },
  });
}

export function buscar(id: string) {
  return prisma.campaign.findUnique({ where: { id } });
}

/** Quantos anexos analisados (B23) estao ligados aos eventos da campanha. */
export function contarAnalisesDaCampanha(id: string) {
  return prisma.fileScan.count({ where: { campaignEvent: { campaignId: id } } });
}

export function excluir(id: string) {
  return prisma.$transaction([
    prisma.campaignEvent.deleteMany({ where: { campaignId: id } }),
    prisma.campaign.delete({ where: { id } }),
  ]);
}

/** Marca `enviadoEm` nos eventos de quem recebeu o e-mail da campanha. */
export function marcarEnviados(campaignId: string, userIds: string[]) {
  return prisma.campaignEvent.updateMany({
    where: { campaignId, userId: { in: userIds } },
    data: { enviadoEm: new Date() },
  });
}
