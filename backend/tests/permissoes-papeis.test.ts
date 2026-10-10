// DT13: permissoes dos papeis da API REST do Supabase (anon, authenticated) sobre o que ficou
// para tras nas migrations antigas (ResetRequest, sequence e funcoes da auditoria).
// Os papeis so existem no Supabase: o teste os cria DENTRO de uma transacao, da a eles as
// permissoes que o Supabase da por padrao a objeto novo, reaplica a migration e desfaz tudo
// no fim (CREATE ROLE tambem e desfeito pelo ROLLBACK). Banco isolado — ver helpers.ts.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { prisma } = await import('../src/config/db.js');

after(() => prisma.$disconnect());

const MIGRATION = readFileSync(
  new URL('../prisma/migrations/20261010120000_revoga_permissoes_sobrando/migration.sql', import.meta.url),
  'utf8',
);
const PAPEIS = ['anon', 'authenticated'] as const;
const FUNCOES = [
  'auditoria_campo(text)',
  'auditoria_calcular_hash(text, text, text, text, text, timestamp)',
  'auditoria_encadear()',
];
const ROLLBACK = new Error('rollback proposital');

type Linha = { papel: string; objeto: string; tem: boolean };

describe('DT13: permissões que sobraram para anon e authenticated', () => {
  it('as funções da auditoria não ficam executáveis por PUBLIC', async () => {
    const linhas = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE n.nspname = 'public'
        AND p.proname IN ('auditoria_campo', 'auditoria_calcular_hash', 'auditoria_encadear')
        AND a.grantee = 0`;
    assert.deepEqual(linhas, []);
  });

  it('com os papéis do Supabase e as permissões padrão dele, a migration fecha tudo', async () => {
    let resultado: Linha[] = [];
    await assert.rejects(prisma.$transaction(async (tx) => {
      for (const papel of PAPEIS) {
        await tx.$executeRawUnsafe(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${papel}') THEN CREATE ROLE ${papel} NOLOGIN; END IF;
        END $$`);
        // O que o Supabase concede por padrao (ALTER DEFAULT PRIVILEGES) a tabela, sequence e funcao novas.
        await tx.$executeRawUnsafe(`GRANT ALL ON "ResetRequest" TO ${papel}`);
        await tx.$executeRawUnsafe(`GRANT ALL ON SEQUENCE "AuditLog_sequencia_seq" TO ${papel}`);
        await tx.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${FUNCOES.join(', ')} TO ${papel}`);
      }
      await tx.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION ${FUNCOES.join(', ')} TO PUBLIC`);

      // Pre-condicao: o cenario do Supabase antes da migration (sem isto o teste passaria vazio).
      const [antes] = await tx.$queryRaw<Array<{ ok: boolean }>>`
        SELECT has_table_privilege('anon', '"ResetRequest"', 'TRUNCATE') AS ok`;
      assert.equal(antes.ok, true);

      await tx.$executeRawUnsafe(MIGRATION);

      resultado = await tx.$queryRaw<Linha[]>`
        SELECT r.rolname AS papel, '"ResetRequest"' AS objeto,
               has_table_privilege(r.oid, '"ResetRequest"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS tem
        FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        UNION ALL
        SELECT r.rolname, 'AuditLog_sequencia_seq',
               has_sequence_privilege(r.oid, '"AuditLog_sequencia_seq"', 'USAGE,SELECT,UPDATE')
        FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        UNION ALL
        SELECT r.rolname, p.oid::regprocedure::text, has_function_privilege(r.oid, p.oid, 'EXECUTE')
        FROM pg_roles r CROSS JOIN pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE r.rolname IN ('anon', 'authenticated') AND n.nspname = 'public'
          AND p.proname IN ('auditoria_campo', 'auditoria_calcular_hash', 'auditoria_encadear')`;
      throw ROLLBACK;
    }), (e) => e === ROLLBACK);

    assert.equal(resultado.length, PAPEIS.length * (2 + FUNCOES.length));
    assert.deepEqual(resultado.filter((l) => l.tem), []);
  });

  it('a trilha continua encadeando e a verificação de integridade continua lendo o hash', async () => {
    await prisma.auditLog.create({ data: { usuarioId: 'u-000', acao: 'TESTE_DT13', detalhe: 'permissoes' } });
    const [linha] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT "hash" = auditoria_calcular_hash("hashAnterior", "id", "usuarioId", "acao", "detalhe", "timestamp") AS ok
      FROM "AuditLog" WHERE "acao" = 'TESTE_DT13'`;
    assert.equal(linha.ok, true);
  });
});
