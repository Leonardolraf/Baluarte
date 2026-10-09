import 'dotenv/config';
import { prisma } from '../src/config/db.js';
import { CATALOGO_ACHADOS, dadosAchado, type ChaveAchado } from '../src/models/catalogoAchado.model.js';
import { STATUS_FINDING } from '../src/models/dominio.model.js';

// Massa do teste de carga (B30, RNF-004). Roda DEPOIS de seed + seed:demo, só no banco
// descartável do `npm run carga` (scripts/carga.mjs recusa outro nome de banco). Cria ativos
// com uma varredura concluída e muitos achados, para a lista paginada de vulnerabilidades ter
// mais de 100 itens (US-003, cenário 3) e o dashboard e o PDF trabalharem com volume. Cada achado
// ganha o histórico de status do B25b (criação "Aberta" e, se o status final for outro, a mudança
// um dia depois), como os achados de verdade: a evolução de 30 dias do dashboard lê esse histórico.
// Determinística: a mesma massa a cada execução (as datas são relativas ao momento da carga).
const ATIVOS = Number(process.env.CARGA_ATIVOS ?? 20);
const ACHADOS_POR_ATIVO = Number(process.env.CARGA_ACHADOS_POR_ATIVO ?? 60);
const DIA_MS = 24 * 60 * 60 * 1000;

async function main() {
  const banco = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!banco.startsWith('baluarte_carga')) throw new Error(`massa de carga só em banco baluarte_carga* (recebi "${banco}")`);

  const chaves = Object.keys(CATALOGO_ACHADOS) as ChaveAchado[];
  const agora = Date.now();
  for (let a = 0; a < ATIVOS; a++) {
    const n = String(a + 1).padStart(2, '0');
    const ativo = await prisma.asset.create({
      data: { nome: `Ativo de carga ${n}`, host: `carga-${n}.empresa.com`, tipo: a % 4 === 0 ? 'Servidor' : 'Aplicacao', status: 'Ativo' },
    });
    const scan = await prisma.scan.create({ data: { assetId: ativo.id, status: 'CONCLUIDA', concluidoEm: new Date(agora - a * DIA_MS) } });
    const { count } = await prisma.finding.createMany({
      data: Array.from({ length: ACHADOS_POR_ATIVO }, (_, i) => ({
        ...dadosAchado(chaves[(a * 7 + i) % chaves.length]),
        scanId: scan.id,
        status: STATUS_FINDING[(a + i) % STATUS_FINDING.length],
        criadoEm: new Date(agora - ((a * ACHADOS_POR_ATIVO + i) % 90) * DIA_MS),
      })),
    });
    const criados = await prisma.finding.findMany({ where: { scanId: scan.id }, select: { id: true, status: true, criadoEm: true } });
    if (criados.length !== count) throw new Error('massa de carga incompleta');
    await prisma.findingStatusChange.createMany({
      data: criados.flatMap((f) => [
        { findingId: f.id, de: null, para: 'Aberta', registradaEm: f.criadoEm },
        ...(f.status === 'Aberta'
          ? []
          : [{ findingId: f.id, de: 'Aberta', para: f.status, usuarioId: 'u-001', registradaEm: new Date(Math.min(agora, f.criadoEm.getTime() + DIA_MS)) }]),
      ]),
    });
  }
  const [ativos, achados] = await Promise.all([prisma.asset.count(), prisma.finding.count()]);
  console.log(`[seed:carga] ${ativos} ativos, ${achados} achados no banco ${banco}.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
