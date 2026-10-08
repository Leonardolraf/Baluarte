import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';

// Acesso ao banco das ciencias do aviso de monitoramento (B18, tabela MonitoringAcknowledgement).

/** Ciencia de um usuario numa versao do texto, ou null. */
export function buscarCiencia(userId: string, versao: string) {
  return prisma.monitoringAcknowledgement.findUnique({ where: { userId_versao: { userId, versao } } });
}

/**
 * Grava a ciencia se ainda nao existe (INSERT ... ON CONFLICT DO NOTHING pela unicidade
 * userId + versao): dois cliques simultaneos nunca viram dois registros nem um erro 500.
 * Devolve true quando gravou agora.
 */
export async function registrarSeNova(userId: string, versao: string): Promise<boolean> {
  const { count } = await prisma.monitoringAcknowledgement.createMany({
    data: [{ userId, versao }],
    skipDuplicates: true,
  });
  return count === 1;
}

/** Uma pagina das ciencias (mais recente primeiro; o id desempata), com o autor, e o total. */
export async function listar(versao: string | undefined, pagina: number, tamanho: number) {
  const where: Prisma.MonitoringAcknowledgementWhereInput = versao ? { versao } : {};
  const [registros, total] = await prisma.$transaction([
    prisma.monitoringAcknowledgement.findMany({
      where,
      orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * tamanho,
      take: tamanho,
      include: { user: { select: { id: true, nome: true, email: true, perfil: true, status: true } } },
    }),
    prisma.monitoringAcknowledgement.count({ where }),
  ]);
  return { registros, total };
}

/** Contas ativas que ainda nao deram ciencia da versao (quem falta ler o texto em vigor). */
export function contarAtivosSemCiencia(versao: string) {
  return prisma.user.count({ where: { status: 'Ativo', ciencias: { none: { versao } } } });
}
