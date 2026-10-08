import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';

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
    // Varredura simulada: os achados so nascem na conclusao (cicloVarredura.service.ts).
    return tx.scan.create({ data: { assetId, status: 'EM_FILA' } });
  });
}

const COM_ATIVO_E_ACHADOS = { asset: true, _count: { select: { findings: true } } } as const;

export function listar() {
  return prisma.scan.findMany({ include: COM_ATIVO_E_ACHADOS, orderBy: { criadoEm: 'desc' } });
}

/** Uma varredura, no mesmo formato da lista (ativo e contagem de achados). */
export function buscar(id: string) {
  return prisma.scan.findUnique({ where: { id }, include: COM_ATIVO_E_ACHADOS });
}

/** Fila -> andamento: varreduras criadas entre os dois limites (nem na fila, nem vencidas). */
export function iniciarAndamento(limiteFila: Date, limiteConclusao: Date) {
  return prisma.scan.updateMany({
    where: { status: 'EM_FILA', criadoEm: { lte: limiteFila, gt: limiteConclusao } },
    data: { status: 'EM_ANDAMENTO' },
  });
}

/** Varreduras ainda nao concluidas que ja passaram da duracao total. */
export function listarVencidas(limiteConclusao: Date) {
  return prisma.scan.findMany({
    where: { status: { not: 'CONCLUIDA' }, criadoEm: { lte: limiteConclusao } },
    select: { id: true, criadoEm: true },
  });
}

/**
 * Conclui a varredura e grava os achados numa transacao. So uma leitura concorrente vence
 * a troca de status; a outra recebe count 0 e sai sem sortear achados.
 */
export function concluirComAchados(scanId: string, concluidoEm: Date, gerarAchados: () => Prisma.FindingCreateManyInput[]) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.scan.updateMany({
      where: { id: scanId, status: { not: 'CONCLUIDA' } },
      data: { status: 'CONCLUIDA', concluidoEm },
    });
    if (count === 0) return;
    // Varredura criada antes desta regra ja nasceu com achados: nao duplica.
    if ((await tx.finding.count({ where: { scanId } })) > 0) return;
    await tx.finding.createMany({ data: gerarAchados() });
  });
}
