-- AlterTable
ALTER TABLE "FileScan" ADD COLUMN     "campaignEventId" TEXT;

-- CreateIndex
CREATE INDEX "FileScan_campaignEventId_idx" ON "FileScan"("campaignEventId");

-- AddForeignKey
ALTER TABLE "FileScan" ADD CONSTRAINT "FileScan_campaignEventId_fkey" FOREIGN KEY ("campaignEventId") REFERENCES "CampaignEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Escrito a mao (B23). Mudanca so aditiva: coluna anulavel, indice e FK; nenhum dado existente
-- muda (as analises antigas ficam sem origem). Sem CHECK nova: o valor e uma FK, e a regra de
-- que o anexo e do proprio destinatario (FileScan.userId = CampaignEvent.userId) cruza tabelas
-- e fica na aplicacao (analiseArquivo.service.ts). Sem RLS nova: a tabela FileScan ja nasceu
-- com RLS ligado e sem politicas (migration 20261008120000_analise_arquivos).
