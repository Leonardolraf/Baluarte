import { prisma } from '../config/db.js';

// Acesso a dados das analises de arquivo (tabela FileScan).

export function criar(dados: {
  userId: string;
  nome: string;
  tamanho: number;
  sha256: string;
  resultado: 'LIMPO' | 'AMEACA';
  ameaca: string | null;
}) {
  return prisma.fileScan.create({ data: dados });
}

/** Quantas analises o usuario fez desde o instante dado (limite por hora). */
export function contarDesde(userId: string, desde: Date) {
  return prisma.fileScan.count({ where: { userId, criadoEm: { gte: desde } } });
}

/** Historico, mais recente primeiro: de um usuario ou de todos (com quem enviou). */
export function listar(userId?: string) {
  return prisma.fileScan.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { criadoEm: 'desc' },
    include: { user: { select: { nome: true, email: true } } },
  });
}
