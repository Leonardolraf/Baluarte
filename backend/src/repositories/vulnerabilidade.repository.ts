import { prisma } from '../config/db.js';
import type { FindingComScan } from '../models/vulnerabilidade.model.js';

export type { FindingComScan };

const COM_ATIVO = { scan: { include: { asset: true } } } as const;

export async function listar(): Promise<FindingComScan[]> {
  return prisma.finding.findMany({ include: COM_ATIVO, orderBy: { criadoEm: 'desc' } });
}

export async function buscar(id: string): Promise<FindingComScan | null> {
  return prisma.finding.findUnique({ where: { id }, include: COM_ATIVO });
}

export function existe(id: string) {
  return prisma.finding.findUnique({ where: { id } });
}

export async function alterarStatus(id: string, status: string): Promise<FindingComScan> {
  return prisma.finding.update({ where: { id }, data: { status }, include: COM_ATIVO });
}
