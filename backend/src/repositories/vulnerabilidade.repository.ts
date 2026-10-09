import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { STATUS_FINDING_ENCERRADO } from '../models/dominio.model.js';
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

/** Achado em aberto: fora de "Resolvida" e "Risco aceito" (a regra dos KPIs). */
const EM_ABERTO: Prisma.FindingWhereInput = { status: { notIn: STATUS_FINDING_ENCERRADO } };

/**
 * O que o dashboard usa dos achados em aberto, agregado no banco (B30, RNF-004): contagem por
 * severidade, quantos tem nota >= `notaCritica` e so os `recentes` mais novos (mesma ordem da
 * lista: o mais recente primeiro, depois o id). Antes o dashboard trazia todos os achados, com
 * ativo e remediacao, a cada leitura: com 1.200 achados e 200 usuarios simultaneos, o p90 passava
 * de 3 s.
 */
export async function panoramaAbertos(recentes: number, notaCritica: number) {
  const [grupos, criticos, lista] = await Promise.all([
    prisma.finding.groupBy({ by: ['severidade'], where: EM_ABERTO, _count: { _all: true } }),
    prisma.finding.count({ where: { ...EM_ABERTO, cvss: { gte: notaCritica } } }),
    prisma.finding.findMany({
      where: EM_ABERTO,
      include: COM_ATIVO,
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: recentes,
    }),
  ]);
  return {
    porSeveridade: grupos.map((g) => ({ severidade: g.severidade, total: g._count._all })),
    criticos,
    recentes: lista as FindingComScan[],
  };
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
 * Como (B30, RNF-004): o historico vira trechos (cada evento vale do seu instante ate o proximo
 * evento do mesmo achado; empate no instante desempata pelo id, e o trecho do evento anterior fica
 * vazio). Um dia passado conta o achado pelo trecho que contem o fim do dia; sem trecho ate ali
 * (nenhum evento), pelo status gravado; o ultimo dia, sempre pelo status gravado. E o mesmo
 * resultado da busca "ultimo evento ate o fim do dia" feita achado a achado, sem as ~30 x achados
 * buscas no indice: com 1.200 achados, de ~125 ms para ~20 ms por leitura (e o dashboard volta a
 * caber no p90 <= 3 s com 200 usuarios simultaneos; ver testes/carga/RELATORIO.md). Acima de
 * dezenas de milhares de achados, guardar uma foto diaria (o que o B25b evitou de proposito).
 * `dia` e a posicao em `fins` (1 = o mais antigo).
 */
export function abertosPorDia(fins: Date[], encerrados: readonly string[]) {
  const instantes = fins.map((f) => f.toISOString());
  const n = instantes.length;
  const fechados = Prisma.join([...encerrados]);
  // `width_bucket(x, fins)` = quantos fins sao <= x (fins em ordem crescente, sem repeticao).
  // Com a precisao de milissegundo das colunas, "quantos fins sao < x" = width_bucket(x - 1 ms).
  return prisma.$queryRaw<Array<{ dia: number; severidade: string; total: number }>>`
    WITH params AS (
      SELECT ARRAY(SELECT t::timestamp(3) FROM unnest(${instantes}::text[]) AS t) AS "fins"
    ),
    trechos AS (
      SELECT e."findingId", e."para", e."registradaEm" AS "inicio",
             LEAD(e."registradaEm") OVER (PARTITION BY e."findingId" ORDER BY e."registradaEm", e."id") AS "termino"
      FROM "FindingStatusChange" e
    ),
    primeiro AS (
      SELECT e."findingId", MIN(e."registradaEm") AS "inicio" FROM "FindingStatusChange" e GROUP BY e."findingId"
    ),
    -- Dias passados (1..n-1) cobertos por cada trecho aberto, e pelo status gravado enquanto o
    -- achado ainda nao tinha evento; sempre a partir do dia em que o achado ja existia.
    faixas AS (
      SELECT f."severidade",
             GREATEST(width_bucket(u."inicio" - interval '1 millisecond', p."fins"),
                      width_bucket(f."criadoEm" - interval '1 millisecond', p."fins")) + 1 AS "de",
             LEAST(CASE WHEN u."termino" IS NULL THEN ${n}
                        ELSE width_bucket(u."termino" - interval '1 millisecond', p."fins") END, ${n} - 1) AS "ate"
      FROM trechos u
      JOIN "Finding" f ON f."id" = u."findingId"
      CROSS JOIN params p
      WHERE u."para" NOT IN (${fechados})
      UNION ALL
      SELECT f."severidade",
             width_bucket(f."criadoEm" - interval '1 millisecond', p."fins") + 1 AS "de",
             LEAST(CASE WHEN pr."inicio" IS NULL THEN ${n}
                        ELSE width_bucket(pr."inicio" - interval '1 millisecond', p."fins") END, ${n} - 1) AS "ate"
      FROM "Finding" f
      LEFT JOIN primeiro pr ON pr."findingId" = f."id"
      CROSS JOIN params p
      WHERE f."status" NOT IN (${fechados})
    ),
    -- Vetor de diferencas: +1 no primeiro dia coberto, -1 no dia seguinte ao ultimo.
    marcas AS (
      SELECT "severidade", "dia", SUM("delta")::int AS "delta" FROM (
        SELECT "severidade", "de" AS "dia", 1 AS "delta" FROM faixas WHERE "de" <= "ate"
        UNION ALL
        SELECT "severidade", "ate" + 1 AS "dia", -1 AS "delta" FROM faixas WHERE "de" <= "ate"
      ) m GROUP BY "severidade", "dia"
    ),
    passado AS (
      SELECT g."dia", s."severidade",
             SUM(COALESCE(m."delta", 0)) OVER (PARTITION BY s."severidade" ORDER BY g."dia")::int AS "total"
      FROM generate_series(1, ${n} - 1) AS g("dia")
      CROSS JOIN (SELECT DISTINCT "severidade" FROM marcas) s
      LEFT JOIN marcas m ON m."dia" = g."dia" AND m."severidade" = s."severidade"
    )
    SELECT "dia", "severidade", "total" FROM passado WHERE "total" > 0
    UNION ALL
    -- Hoje: o status gravado (o fato atual, o mesmo dos KPIs)
    SELECT ${n}::int AS "dia", f."severidade", COUNT(*)::int AS "total"
    FROM "Finding" f CROSS JOIN params p
    WHERE f."criadoEm" <= p."fins"[${n}] AND f."status" NOT IN (${fechados})
    GROUP BY f."severidade"`;
}
