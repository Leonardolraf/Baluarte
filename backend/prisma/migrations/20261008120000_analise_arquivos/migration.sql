-- CreateTable
CREATE TABLE "FileScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    "ameaca" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileScan_userId_criadoEm_idx" ON "FileScan"("userId", "criadoEm");

-- CreateIndex
CREATE INDEX "FileScan_criadoEm_idx" ON "FileScan"("criadoEm");

-- CreateIndex
CREATE INDEX "FileScan_sha256_idx" ON "FileScan"("sha256");

-- AddForeignKey
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Escrito a mao (o Prisma nao modela CHECK nem RLS).
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_resultado_check" CHECK ("resultado" IN ('LIMPO', 'AMEACA'));
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_tamanho_check" CHECK ("tamanho" >= 0);
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_nome_check" CHECK (length("nome") BETWEEN 1 AND 255);
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_ameaca_check" CHECK (("resultado" = 'AMEACA') = ("ameaca" IS NOT NULL));

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "FileScan" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "FileScan" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
