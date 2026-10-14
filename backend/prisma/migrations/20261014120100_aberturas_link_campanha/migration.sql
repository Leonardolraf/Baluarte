-- Melhorias #6: cada abertura do link do e-mail da campanha, para mostrar "aberto N vezes
-- (possivel repasse)". O clique do funil continua sendo CampaignEvent."clicadoEm" (um por
-- pessoa, idempotente); esta tabela e adicional. So aditiva.
--
-- LGPD: "ip" e "userAgent" sao dado pessoal. Retencao de 90 dias (decisao do Leo, 14/10/2026):
-- a API anula os dois depois de 90 dias da abertura, sem apagar a linha, para a contagem nao
-- diminuir com o tempo. Sem funcao no banco de proposito: o plano B (planob.sh) so derruba
-- funcoes "auditoria_%" antes de restaurar no Supabase, e uma funcao com outro nome sobraria
-- la e quebraria a restauracao seguinte.

-- CreateTable
CREATE TABLE "CampaignLinkHit" (
    "id" TEXT NOT NULL,
    "campaignEventId" TEXT NOT NULL,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "CampaignLinkHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignLinkHit_campaignEventId_idx" ON "CampaignLinkHit"("campaignEventId");

-- CreateIndex
CREATE INDEX "CampaignLinkHit_registradoEm_idx" ON "CampaignLinkHit"("registradoEm");

-- AddForeignKey
ALTER TABLE "CampaignLinkHit" ADD CONSTRAINT "CampaignLinkHit_campaignEventId_fkey" FOREIGN KEY ("campaignEventId") REFERENCES "CampaignEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Escrito a mao (o Prisma nao modela CHECK nem RLS).
-- Tamanhos: 45 cabe qualquer IPv6 (inclusive com IPv4 embutido); 512 corta user-agent abusivo.
ALTER TABLE "CampaignLinkHit" ADD CONSTRAINT "CampaignLinkHit_ip_check"
  CHECK ("ip" IS NULL OR (char_length("ip") BETWEEN 1 AND 45));
ALTER TABLE "CampaignLinkHit" ADD CONSTRAINT "CampaignLinkHit_userAgent_check"
  CHECK ("userAgent" IS NULL OR (char_length("userAgent") BETWEEN 1 AND 512));

-- RLS sem politicas: so o dono das tabelas (a API) le e escreve.
ALTER TABLE "CampaignLinkHit" ENABLE ROW LEVEL SECURITY;

-- DT13: objeto novo nasce fechado para a API REST do Supabase. O RLS nao barra TRUNCATE.
-- Os papeis so existem no Supabase.
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "CampaignLinkHit" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
