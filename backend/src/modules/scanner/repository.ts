import { prisma } from '../../platform/db.js';

/**
 * Cria a varredura em fila, se o ativo nao tiver outra em curso (RN-003). A linha do ativo
 * e travada: duas criacoes simultaneas no mesmo ativo ficam em fila aqui. Devolve null se
 * ja existe varredura em curso.
 */
export function criarSeLivre(assetId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Asset" WHERE id = ${assetId} FOR UPDATE`;
    const emCurso = await tx.scan.findFirst({ where: { assetId, status: { not: 'CONCLUIDA' } } });
    if (emCurso) return null;
    // Varredura simulada: os achados so nascem na conclusao (ciclo.ts).
    return tx.scan.create({ data: { assetId, status: 'EM_FILA' } });
  });
}

export function listar() {
  return prisma.scan.findMany({ include: { asset: true, _count: { select: { findings: true } } }, orderBy: { criadoEm: 'desc' } });
}
