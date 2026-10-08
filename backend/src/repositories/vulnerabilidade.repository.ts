import type { Prisma } from '@prisma/client';
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

export function existe(id: string) {
  return prisma.finding.findUnique({ where: { id } });
}

export async function alterarStatus(id: string, status: string): Promise<FindingComOrigem> {
  return prisma.finding.update({ where: { id }, data: { status }, include: COM_ATIVO });
}
