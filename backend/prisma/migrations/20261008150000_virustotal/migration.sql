-- DropIndex
DROP INDEX "FileScan_sha256_idx";

-- AlterTable
ALTER TABLE "FileScan" ADD COLUMN     "vtConsultadoEm" TIMESTAMP(3),
ADD COLUMN     "vtDeteccoes" INTEGER,
ADD COLUMN     "vtMotivo" TEXT,
ADD COLUMN     "vtSituacao" TEXT,
ADD COLUMN     "vtTotal" INTEGER;

-- CreateTable
CREATE TABLE "VirusTotalLookup" (
    "id" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirusTotalLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VirusTotalLookup_criadoEm_idx" ON "VirusTotalLookup"("criadoEm");

-- CreateIndex
CREATE INDEX "FileScan_sha256_vtConsultadoEm_idx" ON "FileScan"("sha256", "vtConsultadoEm");


-- Escrito a mao (o Prisma nao modela CHECK nem RLS). Segunda opiniao do VirusTotal (B20):
-- so o hash sai da API; aqui fica o resultado da consulta, nunca o arquivo.
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_vtSituacao_check"
  CHECK ("vtSituacao" IS NULL OR "vtSituacao" IN ('MALICIOSO', 'SUSPEITO', 'SEM_DETECCAO', 'DESCONHECIDO', 'INDISPONIVEL', 'DESLIGADO'));
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_vtMotivo_check"
  CHECK ("vtMotivo" IS NULL OR "vtMotivo" IN ('COTA', 'CHAVE_INVALIDA', 'LIMITE_VIRUSTOTAL', 'TEMPO_ESGOTADO', 'FALHA'));
-- Motivo so quando a segunda opiniao ficou indisponivel.
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_vtMotivo_situacao_check"
  CHECK (("vtSituacao" IS NOT DISTINCT FROM 'INDISPONIVEL') = ("vtMotivo" IS NOT NULL));
-- Contagens so com veredito do VirusTotal, e deteccoes nunca passam do total.
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_vtContagem_check"
  CHECK (
    (COALESCE("vtSituacao" IN ('MALICIOSO', 'SUSPEITO', 'SEM_DETECCAO'), false)
      = ("vtDeteccoes" IS NOT NULL AND "vtTotal" IS NOT NULL))
    AND ("vtDeteccoes" IS NULL OR "vtDeteccoes" >= 0)
    AND ("vtTotal" IS NULL OR "vtTotal" >= 0)
    AND ("vtDeteccoes" IS NULL OR "vtTotal" IS NULL OR "vtDeteccoes" <= "vtTotal")
  );
-- Data da consulta so quando o VirusTotal respondeu (com relatorio ou 404 desconhecido).
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_vtConsultadoEm_check"
  CHECK (COALESCE("vtSituacao" IN ('MALICIOSO', 'SUSPEITO', 'SEM_DETECCAO', 'DESCONHECIDO'), false) = ("vtConsultadoEm" IS NOT NULL));

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "VirusTotalLookup" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "VirusTotalLookup" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
