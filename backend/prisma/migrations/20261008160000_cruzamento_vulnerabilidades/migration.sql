-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "baseVulnerabilidade" TEXT,
ADD COLUMN     "programa" TEXT,
ADD COLUMN     "programaVersao" TEXT,
ADD COLUMN     "workstationId" TEXT;

-- AlterTable
ALTER TABLE "Workstation" ADD COLUMN     "verificadaEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkstationSoftware" ADD COLUMN     "pacoteOrigem" TEXT;

-- CreateTable
CREATE TABLE "VulnerabilityCache" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "consultadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VulnerabilityCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VulnerabilityCache_expiraEm_idx" ON "VulnerabilityCache"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityCache_base_chave_key" ON "VulnerabilityCache"("base", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_workstationId_cve_programa_key" ON "Finding"("workstationId", "cve", "programa");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Escrito a mao (o Prisma nao modela CHECK nem RLS). Migration so aditiva: colunas novas
-- anulaveis, tabela nova e restricoes que valem so para as colunas novas (as linhas antigas,
-- com tudo nulo, ja as cumprem).
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_baseVulnerabilidade_check" CHECK ("baseVulnerabilidade" IS NULL OR "baseVulnerabilidade" IN ('OSV', 'NVD'));
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_programa_check" CHECK ("programa" IS NULL OR length("programa") BETWEEN 1 AND 512);
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_programaVersao_check" CHECK ("programaVersao" IS NULL OR length("programaVersao") <= 255);
-- Achado de estacao: tem programa, base e CVE juntos (o achado do scanner nao tem nenhum dos dois primeiros).
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_achadoEstacao_check" CHECK (("baseVulnerabilidade" IS NULL) = ("programa" IS NULL) AND ("baseVulnerabilidade" IS NULL OR "cve" IS NOT NULL));
ALTER TABLE "WorkstationSoftware" ADD CONSTRAINT "WorkstationSoftware_pacoteOrigem_check" CHECK ("pacoteOrigem" IS NULL OR length("pacoteOrigem") BETWEEN 1 AND 512);
ALTER TABLE "VulnerabilityCache" ADD CONSTRAINT "VulnerabilityCache_base_check" CHECK ("base" IN ('OSV', 'NVD'));
ALTER TABLE "VulnerabilityCache" ADD CONSTRAINT "VulnerabilityCache_chave_check" CHECK (length("chave") BETWEEN 1 AND 2048);
ALTER TABLE "VulnerabilityCache" ADD CONSTRAINT "VulnerabilityCache_validade_check" CHECK ("expiraEm" >= "consultadoEm");

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "VulnerabilityCache" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "VulnerabilityCache" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
