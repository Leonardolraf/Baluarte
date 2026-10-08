-- CreateTable
CREATE TABLE "ResetRequest" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResetRequest_email_criadoEm_idx" ON "ResetRequest"("email", "criadoEm");

-- CreateIndex
CREATE INDEX "ResetRequest_criadoEm_idx" ON "ResetRequest"("criadoEm");

-- Escrito a mao (o Prisma nao modela CHECK nem RLS). Mesmo limite de LoginFailure.
ALTER TABLE "ResetRequest" ADD CONSTRAINT "ResetRequest_email_check" CHECK (length("email") <= 254);

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "ResetRequest" ENABLE ROW LEVEL SECURITY;
