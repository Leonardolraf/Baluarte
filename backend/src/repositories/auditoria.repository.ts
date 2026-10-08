import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';

/** Grava um registro na trilha de auditoria (tabela AuditLog). */
export function criarRegistro(usuarioId: string | null, acao: string, detalhe: string | null) {
  return prisma.auditLog.create({ data: { usuarioId, acao, detalhe } });
}

/** Criterio da consulta, ja resolvido pelo service (autor por id, periodo fechado). */
export interface CriterioAuditoria {
  acao?: string;
  usuarioId?: string;
  de?: Date;
  ate?: Date;
}

function filtro(c: CriterioAuditoria): Prisma.AuditLogWhereInput {
  return {
    ...(c.acao ? { acao: c.acao } : {}),
    ...(c.usuarioId ? { usuarioId: c.usuarioId } : {}),
    ...(c.de || c.ate ? { timestamp: { ...(c.de ? { gte: c.de } : {}), ...(c.ate ? { lte: c.ate } : {}) } } : {}),
  };
}

/** Uma pagina da trilha, mais recente primeiro (o id desempata registros do mesmo instante), e o total. */
export async function consultar(c: CriterioAuditoria, pagina: number, tamanho: number) {
  const where = filtro(c);
  const [registros, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * tamanho,
      take: tamanho,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { registros, total };
}

/** Acoes distintas ja registradas (alimenta o filtro da tela), em ordem alfabetica. */
export async function acoesDistintas(): Promise<string[]> {
  const linhas = await prisma.auditLog.findMany({ distinct: ['acao'], select: { acao: true }, orderBy: { acao: 'asc' } });
  return linhas.map((l) => l.acao);
}

/** Nome e e-mail dos autores (o AuditLog nao tem FK para User de proposito: busca pelos ids). */
export function usuariosPorIds(ids: string[]) {
  return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, email: true } });
}

/**
 * Registros de mudanca de status de UM achado (historico do detalhe, B25). O detalhe e
 * gravado pelo service como `<id do achado> (<host>, <categoria>): <de> → <para>`: o id vem
 * primeiro, seguido de " (", entao o prefixo identifica o achado sem casar outro id.
 */
export function alteracoesDeStatus(acao: string, findingId: string) {
  return prisma.auditLog.findMany({
    where: { acao, detalhe: { startsWith: `${findingId} (` } },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
}
