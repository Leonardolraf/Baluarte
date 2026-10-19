import { prisma } from '../config/db.js';
import { reservaValidaDesde } from './analiseArquivo.repository.js';

/** Usuarios pelos e-mails (citext: ignora maiusculas). */
export function usuariosPorEmail(emails: string[]) {
  return prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, nome: true, email: true, status: true } });
}

/**
 * Contas candidatas a destinatario de campanha: as dos departamentos dados ou, com `null`,
 * todas. Traz o status e o e-mail para o service aplicar a elegibilidade
 * (`elegivelParaCampanha`, models/campanha.model.ts), que nao fica repetida aqui.
 */
export function candidatosDestinatario(departamentos: string[] | null) {
  return prisma.user.findMany({
    where: departamentos ? { departmentId: { in: departamentos } } : {},
    select: { id: true, nome: true, email: true, status: true, department: { select: { name: true } } },
    orderBy: [{ nome: 'asc' }, { email: 'asc' }],
  });
}

export function criar(dados: { nome: string; template: string }, eventos: { userId: string; destinatario: string; tokenHash: string }[]) {
  return prisma.campaign.create({ data: { ...dados, status: 'AGENDADA', eventos: { create: eventos } } });
}

export function listarComEventos() {
  return prisma.campaign.findMany({ include: { eventos: true }, orderBy: { criadoEm: 'desc' } });
}

/** Campanha com os eventos, o departamento ATUAL de cada destinatario e quantas vezes abriu o link. */
export function relatorio(id: string) {
  return prisma.campaign.findUnique({
    where: { id },
    // `_count.aberturas`: so a quantidade de aberturas do link (Melhorias #6); IP e user-agent nao saem daqui.
    include: { eventos: { include: { user: { select: { department: { select: { name: true } } } }, _count: { select: { aberturas: true } } } } },
  });
}

export function buscar(id: string) {
  return prisma.campaign.findUnique({ where: { id } });
}

/**
 * Quantos anexos (B23) estao ligados aos eventos da campanha: os ja analisados (FileScan) e os
 * em analise agora (reservas validas desde `reservasDesde`), para a exclusao nao apagar o evento
 * no meio de uma analise em curso.
 */
export async function contarAnalisesDaCampanha(id: string, validadeReservaMs: number) {
  const [analisados, [{ n: emAnalise }]] = await Promise.all([
    prisma.fileScan.count({ where: { campaignEvent: { campaignId: id } } }),
    // Reserva com heartbeat em dia, pelo relogio do banco (o mesmo da reserva e da renovacao).
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "FileScanReserva" r JOIN "CampaignEvent" e ON e."id" = r."campaignEventId"
       WHERE e."campaignId" = ${id} AND r."criadoEm" >= ${reservaValidaDesde(validadeReservaMs)}`,
  ]);
  return analisados + emAnalise;
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
