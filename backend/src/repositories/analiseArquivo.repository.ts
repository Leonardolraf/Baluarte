import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import type { ResultadoAnalise } from '../models/analiseArquivo.model.js';
import type { SegundaOpiniaoGravada } from '../models/segundaOpiniao.model.js';

// Acesso a dados das analises de arquivo (tabela FileScan).

export function criar(dados: {
  userId: string;
  nome: string;
  tamanho: number;
  sha256: string;
  resultado: ResultadoAnalise;
  ameaca: string | null;
} & SegundaOpiniaoGravada) {
  return prisma.fileScan.create({ data: dados });
}

/** Quantas analises o usuario fez desde o instante dado (limite por hora). */
export function contarDesde(userId: string, desde: Date) {
  return prisma.fileScan.count({ where: { userId, criadoEm: { gte: desde } } });
}

/** Criterio do historico, ja resolvido pelo service (dono so para o Colaborador). */
export interface CriterioHistorico {
  userId?: string;
  resultado?: ResultadoAnalise;
}

/**
 * Uma pagina do historico, mais recente primeiro (o id desempata analises do mesmo instante,
 * para a paginacao nao repetir nem pular linhas), com quem enviou, e o total do criterio.
 */
export async function listar(c: CriterioHistorico, pagina: number, tamanho: number) {
  const where: Prisma.FileScanWhereInput = {
    ...(c.userId ? { userId: c.userId } : {}),
    ...(c.resultado ? { resultado: c.resultado } : {}),
  };
  const [registros, total] = await prisma.$transaction([
    prisma.fileScan.findMany({
      where,
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * tamanho,
      take: tamanho,
      include: { user: { select: { nome: true, email: true } } },
    }),
    prisma.fileScan.count({ where }),
  ]);
  return { registros, total };
}

/** Quantos arquivos DISTINTOS (por SHA-256) deram ameaca desde o instante dado, de todos os usuarios. */
export async function contarAmeacasDistintasDesde(desde: Date): Promise<number> {
  const linhas = await prisma.fileScan.findMany({
    where: { resultado: 'AMEACA', criadoEm: { gte: desde } },
    distinct: ['sha256'],
    select: { sha256: true },
  });
  return linhas.length;
}
