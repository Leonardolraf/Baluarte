import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import type { EloCadeia } from '../models/auditoria.model.js';

/**
 * Grava um registro na trilha de auditoria (tabela AuditLog). So insercao: `sequencia`,
 * `hashAnterior` e `hash` sao do trigger de INSERT (migration auditoria_cadeia_hash), que
 * serializa as gravacoes com um advisory lock; a aplicacao nunca os informa.
 */
export function criarRegistro(usuarioId: string | null, acao: string, detalhe: string | null) {
  return prisma.auditLog.create({ data: { usuarioId, acao, detalhe } });
}

/**
 * Percorre a cadeia na ordem da `sequencia`, em lotes (paginacao por chave, sem OFFSET).
 * Cada linha traz o hash recalculado pela funcao do banco auditoria_calcular_hash, a mesma
 * do trigger: a formula do hash existe num lugar so. Como a sequencia e tirada dentro do
 * lock e o lock so e solto no COMMIT, um registro novo nunca aparece atras de um ja lido.
 */
export async function* lotesDaCadeia(tamanho: number): AsyncGenerator<EloCadeia[]> {
  let apos = 0n;
  for (;;) {
    const lote = await prisma.$queryRaw<EloCadeia[]>`
      SELECT "id", "timestamp", "sequencia", "hash", "hashAnterior",
             auditoria_calcular_hash("hashAnterior", "id", "usuarioId", "acao", "detalhe", "timestamp") AS "calculado"
      FROM "AuditLog"
      WHERE "sequencia" > ${apos}
      ORDER BY "sequencia"
      LIMIT ${tamanho}`;
    if (lote.length === 0) return;
    yield lote;
    if (lote.length < tamanho) return;
    apos = lote[lote.length - 1].sequencia;
  }
}

/**
 * Aplica a retencao pela funcao do banco auditoria_aplicar_retencao (apaga so o prefixo da
 * cadeia mais antigo que `meses`; o banco recusa menos de 12). Devolve quantos sairam, o
 * corte e a ancora (hash do ultimo apagado = `hashAnterior` do primeiro que ficou).
 */
export async function aplicarRetencao(meses: number) {
  const [r] = await prisma.$queryRaw<{ apagados: bigint; corte: Date; ancora: string | null }[]>`
    SELECT "apagados", "corte", "ancora" FROM auditoria_aplicar_retencao(${meses}::integer)`;
  return { apagados: Number(r.apagados), corte: r.corte, ancora: r.ancora };
}

/**
 * A trava no banco esta ligada? So quando os dois triggers da migration
 * 20261008176000_auditoria_imutavel (branch feat/b29-trava) existem e nao estao desabilitados.
 */
export async function travaAtiva(): Promise<boolean> {
  const [r] = await prisma.$queryRaw<{ ativos: bigint }[]>`
    SELECT count(*) AS "ativos" FROM pg_trigger
    WHERE tgrelid = '"AuditLog"'::regclass
      AND tgname IN ('AuditLog_somente_insercao', 'AuditLog_sem_truncate')
      AND tgenabled <> 'D'`;
  return Number(r.ativos) === 2;
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
