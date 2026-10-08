-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'RESET';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessaoEncerradaEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginFailure" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginFailure_email_criadoEm_idx" ON "LoginFailure"("email", "criadoEm");

-- CreateIndex
CREATE INDEX "LoginFailure_criadoEm_idx" ON "LoginFailure"("criadoEm");

-- Escrito a mao (o Prisma nao modela CHECK nem RLS).
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_tipo_check" CHECK ("tipo" IN ('RESET', 'CONVITE'));
ALTER TABLE "LoginFailure" ADD CONSTRAINT "LoginFailure_email_check" CHECK (length("email") <= 254);

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "LoginFailure" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "LoginFailure" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
