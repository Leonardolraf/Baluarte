import { prisma } from '../../platform/db.js';

/** Achado com a varredura e o ativo (o ativo e identificado pelo host na API). */
export type FindingComScan = {
  id: string; categoriaOwasp: string; cvss: number; severidade: string; descricao: string; evidencia: string;
  cwe: string | null; cve: string | null; cvssVetor: string | null; remediacao: unknown; status: string; criadoEm: Date;
  scan: { asset: { host: string; nome: string } };
};

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
