import { Prisma } from '@prisma/client';
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

/** Ativos com a varredura mais recente e o total de varreduras. */
export function listarComVarreduras() {
  return prisma.asset.findMany({
    include: {
      _count: { select: { scans: true } },
      scans: { orderBy: { criadoEm: 'desc' }, take: 1, select: { id: true, status: true, criadoEm: true, concluidoEm: true } },
    },
    orderBy: { criadoEm: 'desc' },
  });
}

/**
 * Achados que ainda contam como risco, agrupados por ativo e severidade, contados no banco
 * (o achado chega ao ativo pela varredura). `encerrados` sao os status que nao contam.
 */
export function contarAbertosPorAtivo(encerrados: readonly string[]) {
  return prisma.$queryRaw<Array<{ ativoId: string; severidade: string; total: number }>>`
    SELECT s."assetId" AS "ativoId", f."severidade", COUNT(*)::int AS "total"
    FROM "Finding" f
    JOIN "Scan" s ON s."id" = f."scanId"
    WHERE f."status" NOT IN (${Prisma.join([...encerrados])})
    GROUP BY s."assetId", f."severidade"`;
}

/** Nome e host dos ativos pedidos (o ranking do dashboard so precisa disso). */
export function listarResumoPorIds(ids: string[]) {
  return prisma.asset.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, host: true } });
}

export function contar() {
  return prisma.asset.count();
}
