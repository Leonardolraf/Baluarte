import type { CadastroAtivo } from '../models/ativo.model.js';
import { prisma } from '../config/db.js';

export function buscarPorHost(host: string) {
  return prisma.asset.findUnique({ where: { host } });
}

export function buscarPorId(id: string) {
  return prisma.asset.findUnique({ where: { id } });
}

export function criar(dados: CadastroAtivo) {
  return prisma.asset.create({ data: { ...dados, status: 'Ativo' } });
}

/** Ativos com as varreduras (mais recente primeiro) e o status dos achados de cada uma. */
export function listarComVarreduras() {
  return prisma.asset.findMany({
    include: {
      _count: { select: { scans: true } },
      scans: {
        orderBy: { criadoEm: 'desc' },
        select: { id: true, status: true, criadoEm: true, concluidoEm: true, findings: { select: { status: true } } },
      },
    },
    orderBy: { criadoEm: 'desc' },
  });
}

export function contar() {
  return prisma.asset.count();
}
