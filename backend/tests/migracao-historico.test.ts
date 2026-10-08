// B25b — backfill da migration 20261008180000_historico_status_achado, testado como ela roda de
// verdade: o banco recebe as migrations ANTERIORES, ganha achados e registros de auditoria nos
// formatos valido e invalido, e so entao recebe a migration nova (prisma migrate deploy).
// Confere: um evento de criacao por achado (no criadoEm), um evento de mudanca por registro
// ALTERAR_STATUS_VULNERABILIDADE valido de achado existente (autor e instante do registro), e
// nada para o resto (outro achado, prefixo parecido, status fora da lista, formato estranho,
// outra acao, de = para). A leitura do formato substitui o antigo `lerAlteracaoStatus` (B25).
// Banco Postgres isolado (baluarte_test_migracao_historico) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurarBancoDeTeste, rodarNpx } from './helpers.js';

const MIGRATION = '20261008180000_historico_status_achado';
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma');

configurarBancoDeTeste(import.meta.url);
// Copia do schema e das migrations SEM a nova: o banco fica como estava antes do B25b.
const tmp = mkdtempSync(join(tmpdir(), 'baluarte-b25b-'));
const schema = join(tmp, 'schema.prisma');
cpSync(join(prismaDir, 'schema.prisma'), schema);
mkdirSync(join(tmp, 'migrations'));
cpSync(join(prismaDir, 'migrations', 'migration_lock.toml'), join(tmp, 'migrations', 'migration_lock.toml'));
for (const m of readdirSync(join(prismaDir, 'migrations')).filter((n) => /^\d{14}_/.test(n) && n < MIGRATION))
  cpSync(join(prismaDir, 'migrations', m), join(tmp, 'migrations', m), { recursive: true });
rodarNpx(`prisma migrate reset --force --skip-seed --skip-generate --schema "${schema}"`);

const { prisma } = await import('../src/config/db.js');

type Evento = { findingId: string; de: string | null; para: string; usuarioId: string | null; registradaEm: Date };
let eventos: Evento[] = [];

before(async () => {
  const tabela = await prisma.$queryRaw<Array<{ existe: boolean }>>`SELECT to_regclass('"FindingStatusChange"') IS NOT NULL AS "existe"`;
  assert.equal(tabela[0].existe, false, 'antes da migration a tabela não existe');

  await prisma.$executeRawUnsafe(`
    INSERT INTO "Asset"(id, nome, host, tipo) VALUES ('a1', 'Ativo', '10.9.9.9', 'Servidor');
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Scan"(id, "assetId", status, "criadoEm", "concluidoEm") VALUES ('s1', 'a1', 'CONCLUIDA', '2026-09-01', '2026-09-01');
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Finding"(id, "scanId", "categoriaOwasp", cvss, severidade, descricao, evidencia, status, "criadoEm") VALUES
      ('fa', 's1', 'A03:2021 - Injection', 9.8, 'Crítico', 'd', 'e', 'Resolvida', '2026-09-01 10:00'),
      ('fb', 's1', 'A05:2021 - Security Misconfiguration', 5.3, 'Médio', 'd', 'e', 'Em revisão', '2026-09-02 10:00'),
      ('fc', 's1', 'A01:2021 - Broken Access Control', 7.5, 'Alto', 'd', 'e', 'Risco aceito', '2026-09-03 10:00');
  `);
  // fa: duas mudancas validas (a cadeia explica "Resolvida").
  // fb: uma valida (autor nulo) e varias invalidas. fc: nenhuma valida (status mudado sem registro).
  await prisma.$executeRawUnsafe(`
    INSERT INTO "AuditLog"(id, "usuarioId", acao, detalhe, "timestamp") VALUES
      ('l01', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fa (10.9.9.9, A03:2021 - Injection): Aberta → Em revisão', '2026-09-05 10:00'),
      ('l02', 'u-000', 'ALTERAR_STATUS_VULNERABILIDADE', 'fa (10.9.9.9, A03:2021 - Injection): Em revisão → Resolvida', '2026-09-06 10:00'),
      ('l03', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fax (10.9.9.9, A03:2021 - Injection): Aberta → Resolvida', '2026-09-06 11:00'),
      ('l04', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fb (10.9.9.9, A05:2021 - Security Misconfiguration): Aberta → Fechada', '2026-09-06 12:00'),
      ('l05', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fb (10.9.9.9, x): Aberta → Resolvida → Aberta', '2026-09-06 13:00'),
      ('l06', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fb (10.9.9.9, x) Aberta → Resolvida', '2026-09-06 14:00'),
      ('l07', 'u-001', 'OUTRA_ACAO', 'fb (10.9.9.9, x): Aberta → Resolvida', '2026-09-06 15:00'),
      ('l08', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'inexistente (10.9.9.9, x): Aberta → Resolvida', '2026-09-06 16:00'),
      ('l09', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', NULL, '2026-09-06 17:00'),
      ('l10', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fb (10.9.9.9, x): Aberta → Aberta', '2026-09-06 18:00'),
      ('l11', NULL, 'ALTERAR_STATUS_VULNERABILIDADE', 'fb (h, A05:2021 - Security Misconfiguration): Aberta → Em revisão', '2026-09-07 10:00'),
      ('l12', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'fb(h, c): Aberta → Resolvida', '2026-09-07 11:00'),
      ('l13', 'u-001', 'ALTERAR_STATUS_VULNERABILIDADE', 'xx fb (h, c): Aberta → Resolvida', '2026-09-07 12:00');
  `);

  // Aplica a migration nova sobre esses dados, como em producao.
  cpSync(join(prismaDir, 'migrations', MIGRATION), join(tmp, 'migrations', MIGRATION), { recursive: true });
  rodarNpx(`prisma migrate deploy --schema "${schema}"`);
  eventos = await prisma.findingStatusChange.findMany({
    orderBy: [{ registradaEm: 'asc' }, { id: 'asc' }],
    select: { findingId: true, de: true, para: true, usuarioId: true, registradaEm: true },
  });
});
after(async () => {
  await prisma.$disconnect();
  rmSync(tmp, { recursive: true, force: true });
});

const resumo = (findingId: string) =>
  eventos.filter((e) => e.findingId === findingId).map((e) => [e.de, e.para, e.usuarioId, e.registradaEm.toISOString()]);

describe('backfill da migration historico_status_achado', () => {
  it('cada achado ganha o evento de criação (NULL → Aberta) no próprio criadoEm', () => {
    for (const [id, quando] of [['fa', '2026-09-01T10:00:00.000Z'], ['fb', '2026-09-02T10:00:00.000Z'], ['fc', '2026-09-03T10:00:00.000Z']])
      assert.deepEqual(resumo(id)[0], [null, 'Aberta', null, quando], id);
  });

  it('registros válidos viram mudanças, com autor e instante do registro', () => {
    assert.deepEqual(resumo('fa').slice(1), [
      ['Aberta', 'Em revisão', 'u-001', '2026-09-05T10:00:00.000Z'],
      ['Em revisão', 'Resolvida', 'u-000', '2026-09-06T10:00:00.000Z'],
    ]);
    assert.deepEqual(resumo('fb').slice(1), [['Aberta', 'Em revisão', null, '2026-09-07T10:00:00.000Z']]);
  });

  it('o resto é ignorado: nada inventado (fc continua só com a criação)', () => {
    assert.deepEqual(resumo('fc').length, 1);
    assert.equal(eventos.length, 3 + 2 + 1);
    assert.deepEqual([...new Set(eventos.map((e) => e.findingId))].sort(), ['fa', 'fb', 'fc']);
  });

  it('id sequencial na ordem cronológica (criação antes das mudanças)', async () => {
    const ids = await prisma.findingStatusChange.findMany({ orderBy: { id: 'asc' }, select: { registradaEm: true } });
    const tempos = ids.map((e) => e.registradaEm.getTime());
    assert.deepEqual(tempos, [...tempos].sort((a, b) => a - b));
  });

  it('a tabela nasce com RLS, como as outras', async () => {
    const [linha] = await prisma.$queryRaw<Array<{ rls: boolean }>>`SELECT relrowsecurity AS "rls" FROM pg_class WHERE relname = 'FindingStatusChange'`;
    assert.equal(linha.rls, true);
  });
});
