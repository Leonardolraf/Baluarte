-- CreateTable
CREATE TABLE "FindingStatusChange" (
    "id" SERIAL NOT NULL,
    "findingId" TEXT NOT NULL,
    "de" TEXT,
    "para" TEXT NOT NULL,
    "usuarioId" TEXT,
    "registradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FindingStatusChange_findingId_registradaEm_idx" ON "FindingStatusChange"("findingId", "registradaEm");

-- CreateIndex
CREATE INDEX "FindingStatusChange_registradaEm_idx" ON "FindingStatusChange"("registradaEm");

-- AddForeignKey
ALTER TABLE "FindingStatusChange" ADD CONSTRAINT "FindingStatusChange_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Escrito a mao (o Prisma nao modela CHECK nem RLS) — B25b, historico de status do achado.
-- Migration so aditiva: tabela nova, restricoes so dela e o preenchimento a partir do que ja existe.

-- Os status sao os de STATUS_FINDING (src/models/dominio.model.ts), a mesma lista da
-- Finding_status_check. Criacao: de NULL, sempre para 'Aberta' (o status com que todo achado nasce).
-- Mudanca: de e para da lista, e diferentes (repetir o status nao e evento).
ALTER TABLE "FindingStatusChange" ADD CONSTRAINT "FindingStatusChange_para_check" CHECK ("para" IN ('Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'));
ALTER TABLE "FindingStatusChange" ADD CONSTRAINT "FindingStatusChange_de_check" CHECK ("de" IS NULL OR "de" IN ('Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'));
ALTER TABLE "FindingStatusChange" ADD CONSTRAINT "FindingStatusChange_mudanca_check" CHECK ("de" IS NULL OR "de" <> "para");
ALTER TABLE "FindingStatusChange" ADD CONSTRAINT "FindingStatusChange_criacao_check" CHECK ("de" IS NOT NULL OR "para" = 'Aberta');

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "FindingStatusChange" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "FindingStatusChange" FROM %I', papel);
      EXECUTE format('REVOKE ALL ON SEQUENCE "FindingStatusChange_id_seq" FROM %I', papel);
    END IF;
  END LOOP;
END $$;

-- Preenchimento (backfill), so com o que o dado sustenta:
-- 1. todo achado existente ganha o evento de criacao (NULL -> 'Aberta') no proprio criadoEm;
-- 2. cada registro ALTERAR_STATUS_VULNERABILIDADE da auditoria cujo detalhe casa com o formato
--    gravado pela API — `<id> (<host>, <categoria>): <de> → <para>` — e cujo achado ainda existe
--    vira um evento de mudanca, com o autor e o instante do registro. O par de -> para e lido do
--    FIM do detalhe (a categoria tem ":", ex.: "A03:2021 - Injection"), e os dois precisam ser
--    status da lista e diferentes. O resto e ignorado: nada e deduzido nem inventado.
-- Quando a cadeia resultante nao explica o status atual (status mudado sem registro), a API
-- avisa que o historico esta incompleto, como antes.
-- Inserido em ordem cronologica (criacao antes de mudanca no mesmo instante), para o id
-- sequencial seguir a ordem dos fatos.
INSERT INTO "FindingStatusChange" ("findingId", "de", "para", "usuarioId", "registradaEm")
SELECT e."findingId", e."de", e."para", e."usuarioId", e."registradaEm"
FROM (
  SELECT f."id" AS "findingId", NULL::text AS "de", 'Aberta'::text AS "para", NULL::text AS "usuarioId",
         f."criadoEm" AS "registradaEm", 0 AS "ordem", f."id" AS "desempate"
  FROM "Finding" f
  UNION ALL
  SELECT f."id", a.m[2], a.m[3], a."usuarioId", a."timestamp", 1, a."id"
  FROM (
    SELECT l."id", l."usuarioId", l."timestamp",
           regexp_match(l."detalhe", '^([^ ]+) \(.*: (Aberta|Em revisão|Em remediação|Resolvida|Risco aceito) → (Aberta|Em revisão|Em remediação|Resolvida|Risco aceito)$') AS m
    FROM "AuditLog" l
    WHERE l."acao" = 'ALTERAR_STATUS_VULNERABILIDADE' AND l."detalhe" IS NOT NULL
  ) a
  JOIN "Finding" f ON f."id" = a.m[1]
  WHERE a.m IS NOT NULL AND a.m[2] <> a.m[3]
) e
ORDER BY e."registradaEm", e."ordem", e."desempate";
