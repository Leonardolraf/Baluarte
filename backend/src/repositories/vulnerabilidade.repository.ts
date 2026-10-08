import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import type {
  FiltrosVulnerabilidade,
  FindingComOrigem,
  FindingComScan,
  OrdemVulnerabilidade,
} from '../models/vulnerabilidade.model.js';

export type { FindingComScan };

const COM_ATIVO = { scan: { include: { asset: true } } } as const;

/** Campo do banco de cada campo de ordenacao da API. */
const COLUNA = { detectadoEm: 'criadoEm', cvss: 'cvss', descricao: 'descricao' } as const;

/**
 * Filtros da lista e do relatorio como `where` do banco. Severidade e status chegam no
 * rotulo oficial (o controller ja normalizou maiusculas); a busca e por trecho, sem
 * diferenciar maiusculas, no host do ativo, na categoria OWASP, no CVE ou no programa (B14).
 */
function filtro(f: FiltrosVulnerabilidade): Prisma.FindingWhereInput {
  // O `contains` do Prisma vira ILIKE '%termo%' sem escapar curingas: `%` e `_` do usuario
  // casariam qualquer coisa. Escapados (com a barra, o escape padrao do LIKE), a busca e literal.
  const termo = f.q?.replace(/[\\%_]/g, '\\$&');
  return {
    ...(f.severidade ? { severidade: f.severidade } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(termo
      ? {
          OR: [
            { scan: { asset: { host: { contains: termo, mode: 'insensitive' } } } },
            { categoriaOwasp: { contains: termo, mode: 'insensitive' } },
            // Achado de estacao (B14): tambem pelo CVE e pelo programa instalado.
            { cve: { contains: termo, mode: 'insensitive' } },
            { programa: { contains: termo, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

/**
 * Ordem estavel: o campo pedido, depois o mais recente e, por ultimo, o id (unico), para que
 * achados empatados nunca troquem de pagina entre duas leituras.
 */
function ordem(o: OrdemVulnerabilidade): Prisma.FindingOrderByWithRelationInput[] {
  const coluna = COLUNA[o.campo];
  return [
    { [coluna]: o.direcao },
    ...(coluna === 'criadoEm' ? [] : [{ criadoEm: 'desc' as const }]),
    { id: o.direcao },
  ];
}

/**
 * Uma pagina da lista e os numeros do filtro inteiro (nao so da pagina): total, ativos
 * distintos e contagem por severidade e por status, tudo calculado no banco.
 */
export async function listarPagina(f: FiltrosVulnerabilidade, o: OrdemVulnerabilidade, pagina: number, tamanho: number) {
  const where = filtro(f);
  const [findings, total, ativos, porSeveridade, porStatus] = await Promise.all([
    prisma.finding.findMany({ where, include: COM_ATIVO, orderBy: ordem(o), skip: (pagina - 1) * tamanho, take: tamanho }),
    prisma.finding.count({ where }),
    prisma.asset.count({ where: { scans: { some: { findings: { some: where } } } } }),
    prisma.finding.groupBy({ by: ['severidade'], where, _count: { _all: true } }),
    prisma.finding.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ]);
  return {
    findings: findings as FindingComScan[],
    total,
    ativos,
    porSeveridade: porSeveridade.map((g) => ({ rotulo: g.severidade, total: g._count._all })),
    porStatus: porStatus.map((g) => ({ rotulo: g.status, total: g._count._all })),
  };
}

/** Todos os achados do filtro, sem paginar (o relatorio em PDF exporta o filtro inteiro). */
export async function listarFiltrados(f: FiltrosVulnerabilidade): Promise<FindingComScan[]> {
  return prisma.finding.findMany({ where: filtro(f), include: COM_ATIVO, orderBy: ordem({ campo: 'detectadoEm', direcao: 'desc' }) });
}

/** Todos os achados, o mais recente primeiro (o dashboard agrega em memoria). */
export async function listar(): Promise<FindingComScan[]> {
  return prisma.finding.findMany({ include: COM_ATIVO, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }] });
}

export async function buscar(id: string): Promise<FindingComOrigem | null> {
  return prisma.finding.findUnique({ where: { id }, include: COM_ATIVO });
}

/**
 * Muda o status e grava o evento do historico (B25b) numa UNICA instrucao SQL. O CTE trava a
 * linha do achado (FOR UPDATE; em READ COMMITTED, quem espera a trava rele a versao mais nova
 * da linha), atualiza e insere o evento so se o status mudou. Duas mudancas simultaneas ficam
 * em fila e a cadeia de eventos nunca registra um `de` que ja nao era o status. Repetir o status
 * atual nao grava evento. Devolve null se o achado nao existe.
 *
 * Nao e uma transacao interativa ($transaction com callback) de proposito: com varias mudancas
 * simultaneas no mesmo achado, as transacoes interativas ficavam esperando a trava segurando a
 * conexao e estouravam o maxWait do Prisma ("Unable to start a transaction in the given time").
 */
export async function alterarStatus(
  id: string,
  status: string,
  usuarioId: string | null,
): Promise<{ anterior: string; finding: FindingComOrigem } | null> {
  const linhas = await prisma.$queryRaw<Array<{ anterior: string }>>`
    WITH alvo AS (
      SELECT "id", "status" FROM "Finding" WHERE "id" = ${id} FOR UPDATE
    ), mudou AS (
      UPDATE "Finding" AS f SET "status" = ${status}
      FROM alvo WHERE f."id" = alvo."id"
      RETURNING alvo."status" AS anterior
    ), evento AS (
      INSERT INTO "FindingStatusChange" ("findingId", "de", "para", "usuarioId")
      SELECT ${id}, anterior, ${status}, ${usuarioId}::text FROM mudou WHERE anterior <> ${status}
    )
    SELECT anterior FROM mudou`;
  if (!linhas.length) return null;
  const finding = await prisma.finding.findUnique({ where: { id }, include: COM_ATIVO });
  if (!finding) return null;
  return { anterior: linhas[0].anterior, finding };
}

// ---- Historico de status (B25b) ---------------------------------------------------

/**
 * Evento de criacao (de NULL -> status inicial) dos achados de uma varredura, no instante em que
 * cada um nasceu. Chamado dentro da transacao que grava os achados (conclusao da varredura
 * simulada e cruzamento do B14), sempre numa varredura cujos achados acabaram de ser criados.
 */
export async function registrarCriacaoDosAchados(tx: Prisma.TransactionClient, scanId: string): Promise<void> {
  const achados = await tx.finding.findMany({ where: { scanId }, select: { id: true, status: true, criadoEm: true } });
  if (!achados.length) return;
  await tx.findingStatusChange.createMany({
    data: achados.map((a) => ({ findingId: a.id, de: null, para: a.status, registradaEm: a.criadoEm })),
  });
}

/** Eventos de status de um achado, em ordem cronologica (o id sequencial desempata o mesmo instante). */
export function historicoStatus(findingId: string) {
  return prisma.findingStatusChange.findMany({ where: { findingId }, orderBy: [{ registradaEm: 'asc' }, { id: 'asc' }] });
}

/**
 * Achados abertos por severidade ao fim de cada dia (evolucao do risco, B25b), numa consulta so.
 * `fins` sao os instantes em que os dias terminam, do mais antigo ao mais recente; o ultimo e
 * "agora". Um achado conta no dia se foi criado ate o fim dele e o ultimo evento ate ali o deixa
 * num status aberto (fora de `encerrados`). No ultimo dia (agora) vale o status gravado no
 * achado, que e o fato atual: assim o ultimo ponto bate com os KPIs mesmo quando a cadeia de
 * eventos de algum achado esta incompleta. Achado sem nenhum evento ate o dia (inserido por
 * fora da API) usa o status gravado.
 *
 * Custo: para cada dia, uma busca pelo indice (findingId, registradaEm) por achado criado ate
 * ali, ou seja ~30 x achados buscas por leitura do dashboard. Adequado ate dezenas de milhares
 * de achados; acima disso, guardar uma foto diaria (o que este item evitou de proposito).
 * `dia` e a posicao em `fins` (1 = o mais antigo).
 */
export function abertosPorDia(fins: Date[], encerrados: readonly string[]) {
  const instantes = fins.map((f) => f.toISOString());
  return prisma.$queryRaw<Array<{ dia: number; severidade: string; total: number }>>`
    WITH dias AS (
      SELECT t."fim"::timestamp(3) AS "fim", t."ordem"::int AS "dia", t."ordem" = ${instantes.length} AS "atual"
      FROM unnest(${instantes}::text[]) WITH ORDINALITY AS t("fim", "ordem")
    )
    SELECT d."dia", f."severidade", COUNT(*)::int AS "total"
    FROM dias d
    JOIN "Finding" f ON f."criadoEm" <= d."fim"
    LEFT JOIN LATERAL (
      SELECT e."para"
      FROM "FindingStatusChange" e
      WHERE e."findingId" = f."id" AND e."registradaEm" <= d."fim"
      ORDER BY e."registradaEm" DESC, e."id" DESC
      LIMIT 1
    ) u ON NOT d."atual"
    WHERE (CASE WHEN d."atual" THEN f."status" ELSE COALESCE(u."para", f."status") END) NOT IN (${Prisma.join([...encerrados])})
    GROUP BY d."dia", f."severidade"`;
}
