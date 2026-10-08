-- CreateTable
CREATE TABLE "MonitoringAcknowledgement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versao" TEXT NOT NULL,
    "registradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoringAcknowledgement_versao_registradaEm_idx" ON "MonitoringAcknowledgement"("versao", "registradaEm");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringAcknowledgement_userId_versao_key" ON "MonitoringAcknowledgement"("userId", "versao");

-- AddForeignKey
ALTER TABLE "MonitoringAcknowledgement" ADD CONSTRAINT "MonitoringAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Escrito a mao (o Prisma nao modela CHECK nem RLS). Migration so aditiva: uma tabela nova,
-- sem tocar nas existentes. Ciencia do aviso de monitoramento da estacao (B18, LGPD).
-- Versao do texto: o mesmo formato que a API valida (VERSAO_AVISO, ex.: 2026-10-08).
ALTER TABLE "MonitoringAcknowledgement" ADD CONSTRAINT "MonitoringAcknowledgement_versao_check" CHECK ("versao" ~ '^[0-9A-Za-z._-]{1,32}$');

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "MonitoringAcknowledgement" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "MonitoringAcknowledgement" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
