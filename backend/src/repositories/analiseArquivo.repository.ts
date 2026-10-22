import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { hashToken } from '../utils/tokens.js';
import type { ResultadoAnalise } from '../models/analiseArquivo.model.js';
import type { SegundaOpiniaoGravada } from '../models/segundaOpiniao.model.js';

// Acesso a dados das analises de arquivo (tabela FileScan) e das vagas reservadas nos limites
// de envio (tabela FileScanReserva, DT09).

// ---- Reserva de vaga nos limites (DT09) ----
// Contar antes do antivirus e gravar o FileScan depois do veredito deixava N envios simultaneos
// lerem a mesma contagem e passarem todos. A vaga e uma linha de FileScanReserva gravada antes
// do antivirus, numa instrucao que conta e grava sob um advisory lock da transacao por usuario
// (o padrao de auth.repository.ts#reservar). Uma trava so por usuario cobre tambem o limite do
// evento de campanha: o evento e do proprio usuario (conferido antes), entao todo anexo dele
// passa pela mesma trava. O lote tem tres instrucoes curtas, sem codigo da aplicacao no meio
// (nunca o antivirus): a conexao fica presa so o tempo delas.

export type ReservaAnalise = { id: string | null; naHora: number; emCurso: number; noEvento: number };

/**
 * Relogio da reserva: o instante do BANCO, lido na propria instrucao (`clock_timestamp()`, nao
 * `now()`, que e o inicio da transacao), em UTC e no tipo da coluna (timestamp(3)), sem depender
 * do fuso da sessao. Toda escrita e toda comparacao do `criadoEm` de FileScanReserva usam esta
 * mesma origem: a gravacao da reserva (depois da trava), o heartbeat, a poda e as contagens.
 *
 * Antes a data vinha da aplicacao, lida ANTES da trava e da fila de conexoes: a reserva que
 * esperava (trava de outro envio do mesmo usuario, banco lento) nascia com a idade da espera e,
 * se a espera passasse da validade, nascia vencida, sem contar no limite e podavel antes do
 * primeiro heartbeat (mesma familia do DT10: instante lido antes da trava).
 */
const AGORA_UTC = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)`;

/** Corte da validade (`validadeMs` antes de agora, pelo mesmo relogio): reserva anterior a ele nao conta. */
export function reservaValidaDesde(validadeMs: number) {
  return Prisma.sql`(${AGORA_UTC} - ${Math.round(validadeMs)}::int * interval '1 millisecond')`;
}

/**
 * Reserva a vaga de uma analise: grava a linha so se o usuario tem menos de `maximoHora`
 * analises (FileScan desde `desde` + reservas validas), menos de `maximoSimultaneas` analises
 * em andamento (reservas validas) e, com `eventoId`, o evento tem menos de `maximoEvento` anexos
 * (FileScan + reservas validas). Devolve o id da reserva (null quando algum limite ja estava
 * cheio) e as contagens que havia antes. Reservas sem heartbeat em dia (mais velhas que
 * `validadeMs`) nao contam e sao podadas. A reserva nova nasce com o instante do banco lido
 * depois da trava (`AGORA_UTC`). Cada reserva e uma linha so: renovada ou nao, conta uma vez, e
 * deixa de contar na mesma transacao que grava o FileScan (`criar`).
 */
export async function reservarVaga(p: {
  userId: string;
  eventoId: string | null;
  desde: Date;
  validadeMs: number;
  maximoHora: number;
  maximoSimultaneas: number;
  maximoEvento: number;
}): Promise<ReservaAnalise> {
  const id = randomUUID();
  // A janela de 1 h compara com FileScan.criadoEm, gravado pelo Prisma com a data da aplicacao:
  // segue em texto UTC -> timestamp(3). So o relogio da reserva e o do banco.
  const desde = p.desde.toISOString();
  const validaDesde = reservaValidaDesde(p.validadeMs);
  const [, , linhas] = await prisma.$transaction([
    // Duas chaves de 32 bits: espaco proprio, sem cruzar com as travas do login e da auditoria.
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('baluarte.FileScanReserva'), hashtext(${p.userId}))`,
    prisma.$executeRaw`DELETE FROM "FileScanReserva" WHERE "userId" = ${p.userId} AND "criadoEm" < ${validaDesde}`,
    // Instrucao separada da trava: em READ COMMITTED ela le o que foi gravado ate a trava sair.
    prisma.$queryRaw<Array<{ naHora: number; emCurso: number; noEvento: number; id: string | null }>>`
      WITH relogio AS (
        SELECT ${AGORA_UTC} AS agora, ${validaDesde} AS valida
      ), emcurso AS (
        SELECT count(*) AS n FROM "FileScanReserva"
         WHERE "userId" = ${p.userId} AND "criadoEm" >= (SELECT valida FROM relogio)
      ), hora AS (
        SELECT (SELECT count(*) FROM "FileScan"
                 WHERE "userId" = ${p.userId} AND "criadoEm" >= ${desde}::timestamp(3))
             + (SELECT count(*) FROM "FileScanReserva"
                 WHERE "userId" = ${p.userId} AND "criadoEm" >= (SELECT valida FROM relogio)) AS n
      ), evento AS (
        SELECT CASE WHEN ${p.eventoId}::text IS NULL THEN 0 ELSE
                 (SELECT count(*) FROM "FileScan" WHERE "campaignEventId" = ${p.eventoId}::text)
               + (SELECT count(*) FROM "FileScanReserva"
                   WHERE "campaignEventId" = ${p.eventoId}::text AND "criadoEm" >= (SELECT valida FROM relogio))
               END AS n
      ), nova AS (
        INSERT INTO "FileScanReserva" ("id", "userId", "campaignEventId", "criadoEm")
        SELECT ${id}, ${p.userId}, ${p.eventoId}::text, relogio.agora FROM relogio, hora, emcurso, evento
         WHERE hora.n < ${p.maximoHora} AND emcurso.n < ${p.maximoSimultaneas} AND evento.n < ${p.maximoEvento}
        RETURNING "id"
      )
      SELECT hora.n::int AS "naHora", emcurso.n::int AS "emCurso", evento.n::int AS "noEvento",
             (SELECT "id" FROM nova) AS id
        FROM hora, emcurso, evento`,
  ]);
  const [l] = linhas;
  return { id: l.id, naHora: l.naHora, emCurso: l.emCurso, noEvento: l.noEvento };
}

/**
 * Heartbeat da reserva: poe o `criadoEm` no instante do banco (`AGORA_UTC`), a mesma origem da
 * gravacao e das comparacoes de `reservarVaga`. So a propria linha; se ela ja virou FileScan ou
 * foi devolvida, nao acha nada e nao faz nada.
 */
export function renovarReserva(id: string) {
  return prisma.$executeRaw`UPDATE "FileScanReserva" SET "criadoEm" = ${AGORA_UTC} WHERE "id" = ${id}`;
}

/** Devolve a vaga de uma analise que nao chegou ao fim (antivirus fora, arquivo grande, sem arquivo). */
export function liberarReserva(id: string) {
  return prisma.fileScanReserva.deleteMany({ where: { id } });
}

/**
 * Grava a analise e consome a reserva na mesma transacao: a vaga nunca fica contada duas vezes
 * nem some entre um passo e outro.
 */
export async function criar(reservaId: string, dados: {
  userId: string;
  nome: string;
  tamanho: number;
  sha256: string;
  resultado: ResultadoAnalise;
  ameaca: string | null;
  campaignEventId?: string | null;
} & SegundaOpiniaoGravada) {
  const [registro] = await prisma.$transaction([
    prisma.fileScan.create({ data: dados, include: INCLUI_CAMPANHA }),
    prisma.fileScanReserva.deleteMany({ where: { id: reservaId } }),
  ]);
  return registro;
}

/** Campanha de origem (B23) junto da analise: so o id e o nome, nunca o token do link. */
const INCLUI_CAMPANHA = {
  campaignEvent: { select: { campaign: { select: { id: true, nome: true } } } },
} satisfies Prisma.FileScanInclude;

/**
 * Quantas analises contam no limite por hora do usuario: as feitas desde `desde` mais as vagas
 * reservadas em curso (com heartbeat em dia, pelo relogio do banco). So leitura: quem vai mesmo
 * analisar usa `reservarVaga`.
 */
export async function contarNaHora(userId: string, desde: Date, validadeMs: number) {
  const [feitas, [{ n: emCurso }]] = await prisma.$transaction([
    prisma.fileScan.count({ where: { userId, criadoEm: { gte: desde } } }),
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "FileScanReserva" WHERE "userId" = ${userId} AND "criadoEm" >= ${reservaValidaDesde(validadeMs)}`,
  ]);
  return feitas + emCurso;
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
