-- CreateTable
CREATE TABLE "FileScanReserva" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignEventId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileScanReserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileScanReserva_userId_criadoEm_idx" ON "FileScanReserva"("userId", "criadoEm");

-- CreateIndex
CREATE INDEX "FileScanReserva_campaignEventId_idx" ON "FileScanReserva"("campaignEventId");

-- AddForeignKey
ALTER TABLE "FileScanReserva" ADD CONSTRAINT "FileScanReserva_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileScanReserva" ADD CONSTRAINT "FileScanReserva_campaignEventId_fkey" FOREIGN KEY ("campaignEventId") REFERENCES "CampaignEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Escrito a mao (DT09). Mudanca so aditiva: tabela nova, nenhum dado existente muda. A vaga dos
-- limites da analise de arquivos (20 por hora por usuario, 5 anexos por evento de campanha) e
-- reservada aqui antes do antivirus e trocada pelo FileScan depois (ou apagada se a analise
-- falhar). Sem CHECK: nenhuma coluna tem lista fixa de valores. A regra de que o evento e do
-- proprio usuario (CampaignEvent.userId = userId) cruza tabelas e fica na aplicacao, como no
-- FileScan.campaignEventId (migration 20261008200000_analise_origem_campanha).
-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "FileScanReserva" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "FileScanReserva" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
