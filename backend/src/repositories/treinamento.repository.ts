import { randomUUID } from 'node:crypto';
import { prisma } from '../config/db.js';
import { hashToken } from '../utils/tokens.js';

// Eventos de campanha vistos pelo lado do treinamento (clique, conclusao, reporte).

export function eventoPorId(id: string) {
  return prisma.campaignEvent.findUnique({ where: { id }, include: { campaign: true } });
}

/** Evento pelo token do link do e-mail: no banco fica so o hash. */
export function eventoPeloLink(token: string) {
  return prisma.campaignEvent.findUnique({ where: { tokenHash: hashToken(token.trim()) }, include: { campaign: true } });
}

export function marcarConcluido(id: string) {
  return prisma.campaignEvent.update({ where: { id }, data: { treinou: true, treinouEm: new Date() } });
}

export function marcarClique(id: string, agora: Date, abertoEm: Date) {
  return prisma.campaignEvent.update({ where: { id }, data: { clicadoEm: agora, abertoEm } });
}

/** Grava o reporte so se ainda nao havia (reportes simultaneos nao registram duas vezes). */
export async function marcarReporte(id: string, agora: Date, abertoEm: Date): Promise<boolean> {
  const { count } = await prisma.campaignEvent.updateMany({ where: { id, reportouEm: null }, data: { reportouEm: agora, abertoEm } });
  return count === 1;
}

export async function dataDoReporte(id: string) {
  return (await prisma.campaignEvent.findUniqueOrThrow({ where: { id } })).reportouEm;
}

/** Totais e conclusoes nominais de todas as campanhas (tela de treinamentos). */
export function consolidado() {
  return Promise.all([
    prisma.campaign.count(),
    prisma.campaignEvent.count({ where: { clicadoEm: { not: null } } }),
    prisma.campaignEvent.findMany({
      where: { clicadoEm: { not: null }, treinou: true },
      select: {
        campaign: { select: { id: true, nome: true } },
        user: { select: { id: true, nome: true, email: true, department: { select: { name: true } } } },
      },
    }),
  ]);
}

/**
 * Grava a abertura do link (Melhorias #6) so se o evento nao tem abertura depois de `limite`
 * (janela) e tem menos de `teto` linhas. Devolve se gravou. Seguro sob concorrencia: a linha do
 * CampaignEvent fica travada (FOR UPDATE) ate o fim da transacao, e o INSERT condicional vem
 * numa instrucao separada, que em READ COMMITTED ja enxerga o que o anterior gravou. Datas como
 * texto UTC -> timestamp(3), como o Prisma grava (now() do banco nao entra: licao do DT10).
 */
export async function registrarAbertura(
  campaignEventId: string,
  dados: { ip: string | null; userAgent: string | null },
  agora: Date,
  limite: Date,
  teto: number,
): Promise<boolean> {
  const id = randomUUID();
  const [, gravadas] = await prisma.$transaction([
    prisma.$queryRaw`SELECT "id" FROM "CampaignEvent" WHERE "id" = ${campaignEventId} FOR UPDATE`,
    prisma.$executeRaw`
      INSERT INTO "CampaignLinkHit" ("id", "campaignEventId", "registradoEm", "ip", "userAgent")
      SELECT ${id}, ${campaignEventId}, ${agora.toISOString()}::timestamp(3), ${dados.ip}::text, ${dados.userAgent}::text
       WHERE NOT EXISTS (
               SELECT 1 FROM "CampaignLinkHit"
                WHERE "campaignEventId" = ${campaignEventId}
                  AND "registradoEm" > ${limite.toISOString()}::timestamp(3))
         AND (SELECT count(*) FROM "CampaignLinkHit" WHERE "campaignEventId" = ${campaignEventId}) < ${teto}`,
  ]);
  return gravadas === 1;
}

/**
 * Retencao LGPD: anula IP e user-agent das aberturas mais velhas que `dias`, sem apagar a linha
 * (a contagem de aberturas nao diminui). O indice em registradoEm deixa a consulta barata.
 */
export function anularDadosDeAberturasAntigas(dias: number) {
  return prisma.$executeRaw`
    UPDATE "CampaignLinkHit" SET "ip" = NULL, "userAgent" = NULL
    WHERE "registradoEm" < now() - make_interval(days => ${dias}::int)
      AND ("ip" IS NOT NULL OR "userAgent" IS NOT NULL)`;
}
