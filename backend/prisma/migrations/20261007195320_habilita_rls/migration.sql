-- Row Level Security em todas as tabelas, SEM politicas.
-- No Supabase, o schema public fica exposto pela API REST (PostgREST) a quem tem a chave
-- anon — que e publica. Com RLS ligado e nenhuma politica, os papeis anon/authenticated
-- nao leem nem escrevem nada. O backend nao e afetado: o Prisma conecta como dono das
-- tabelas, e o dono ignora RLS (nao ha FORCE ROW LEVEL SECURITY).
-- No Postgres local nao existem os papeis do Supabase; o bloco abaixo so revoga se existirem.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
-- A tabela de controle do Prisma existe no banco real, mas nao no banco-sombra do `migrate dev`
-- (DT01): so liga o RLS nela se ela existir.
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', papel);
    END IF;
  END LOOP;
END $$;
