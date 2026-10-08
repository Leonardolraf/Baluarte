import { prisma } from '../../platform/db.js';

export function buscar(userId: string) {
  return prisma.notificationPreference.findUnique({ where: { userId } });
}

export function criarPadrao(userId: string) {
  return prisma.notificationPreference.create({ data: { userId } });
}

export function salvar(userId: string, dados: Record<string, boolean>) {
  return prisma.notificationPreference.upsert({ where: { userId }, update: dados, create: { userId, ...dados } });
}
