import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { hashToken } from '../utils/tokens.js';
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
  campaignEventId?: string | null;
} & SegundaOpiniaoGravada) {
  return prisma.fileScan.create({ data: dados, include: INCLUI_CAMPANHA });
}

/** Campanha de origem (B23) junto da analise: so o id e o nome, nunca o token do link. */
const INCLUI_CAMPANHA = {
  campaignEvent: { select: { campaign: { select: { id: true, nome: true } } } },
} satisfies Prisma.FileScanInclude;

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
      include: { user: { select: { nome: true, email: true } }, ...INCLUI_CAMPANHA },
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

/**
 * Evolucao do risco (B25b): para cada janela [desde, ate], quantos arquivos DISTINTOS (por
 * SHA-256) deram ameaca nela, numa consulta so. `dia` e a posicao da janela (1 = a primeira).
 */
export function contarAmeacasDistintasPorJanela(janelas: Array<{ desde: Date; ate: Date }>) {
  const desde = janelas.map((j) => j.desde.toISOString());
  const ate = janelas.map((j) => j.ate.toISOString());
  return prisma.$queryRaw<Array<{ dia: number; total: number }>>`
    SELECT t."ordem"::int AS "dia",
           (SELECT COUNT(DISTINCT s."sha256")::int
              FROM "FileScan" s
             WHERE s."resultado" = 'AMEACA'
               AND s."criadoEm" >= t."desde"::timestamp(3)
               AND s."criadoEm" <= t."ate"::timestamp(3)) AS "total"
    FROM unnest(${desde}::text[], ${ate}::text[]) WITH ORDINALITY AS t("desde", "ate", "ordem")`;
}

// ---- Anexo suspeito de campanha (B23) ---------------------------------------------

/** Evento (destinatario numa campanha) do proprio usuario; o dono vem do login, nunca da query. */
export function eventoDoUsuario(eventoId: string, userId: string) {
  return prisma.campaignEvent.findFirst({
    where: { id: eventoId, userId },
    select: { id: true, enviadoEm: true, campaign: { select: { id: true, nome: true } } },
  });
}

/** Quantos anexos ja foram enviados para analise a partir deste evento. */
export function contarAnexosDoEvento(eventoId: string) {
  return prisma.fileScan.count({ where: { campaignEventId: eventoId } });
}

/** Campanhas que o usuario recebeu (e-mail enviado), mais recente primeiro, com os anexos ja enviados. */
export function campanhasRecebidas(userId: string, limite: number) {
  return prisma.campaignEvent.findMany({
    where: { userId, enviadoEm: { not: null } },
    orderBy: [{ enviadoEm: 'desc' }, { id: 'desc' }],
    take: limite,
    select: {
      id: true,
      enviadoEm: true,
      campaign: { select: { id: true, nome: true } },
      _count: { select: { anexos: true } },
    },
  });
}

/** Id do evento do link do e-mail, so se for do usuario dado (nada revela de evento alheio). */
export async function eventoDoLink(token: string, userId: string): Promise<string | null> {
  const evento = await prisma.campaignEvent.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, userId: true } });
  return evento && evento.userId === userId ? evento.id : null;
}

/** Anexos reportados numa campanha (relatorio dos operadores), mais recente primeiro. */
export function anexosDaCampanha(campaignId: string) {
  return prisma.fileScan.findMany({
    where: { campaignEvent: { campaignId } },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    select: {
      id: true, nome: true, sha256: true, resultado: true, ameaca: true, criadoEm: true,
      campaignEvent: { select: { destinatario: true } },
    },
  });
}
