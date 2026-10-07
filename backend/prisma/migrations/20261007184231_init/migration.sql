-- citext: e-mail e nome de departamento comparados sem diferenciar maiusculas.
-- (Escrito a mao: o Prisma 5 so gera extensoes com a preview feature postgresqlExtensions.)
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "perfil" TEXT NOT NULL DEFAULT 'Analista',
    "status" TEXT NOT NULL DEFAULT 'Ativo',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senhaAlteradaEm" TIMESTAMP(3),
    "departmentId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" CITEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "alertasEmail" BOOLEAN NOT NULL DEFAULT true,
    "somenteCriticas" BOOLEAN NOT NULL DEFAULT false,
    "resumoSemanal" BOOLEAN NOT NULL DEFAULT true,
    "relatoriosCampanha" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Ativo',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_FILA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "categoriaOwasp" TEXT NOT NULL,
    "cvss" DOUBLE PRECISION NOT NULL,
    "severidade" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "evidencia" TEXT NOT NULL,
    "cwe" TEXT,
    "cve" TEXT,
    "cvssVetor" TEXT,
    "remediacao" JSONB,
    "status" TEXT NOT NULL DEFAULT 'Aberta',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGENDADA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "tokenHash" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "abertoEm" TIMESTAMP(3),
    "clicadoEm" TIMESTAMP(3),
    "submeteuEm" TIMESTAMP(3),
    "reportouEm" TIMESTAMP(3),
    "treinou" BOOLEAN NOT NULL DEFAULT false,
    "treinouEm" TIMESTAMP(3),

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_host_key" ON "Asset"("host");

-- CreateIndex
CREATE INDEX "Scan_assetId_idx" ON "Scan"("assetId");

-- CreateIndex
CREATE INDEX "Finding_scanId_idx" ON "Finding"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_tokenHash_key" ON "CampaignEvent"("tokenHash");

-- CreateIndex
CREATE INDEX "CampaignEvent_userId_idx" ON "CampaignEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_campaignId_userId_key" ON "CampaignEvent"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_usuarioId_idx" ON "AuditLog"("usuarioId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Valores fixos garantidos pelo banco (escrito a mao: o Prisma nao modela CHECK).
-- As listas sao as mesmas de src/util.ts; mudar uma exige migration nova.
ALTER TABLE "User" ADD CONSTRAINT "User_perfil_check" CHECK ("perfil" IN ('Administrador', 'Analista', 'Colaborador'));
ALTER TABLE "User" ADD CONSTRAINT "User_status_check" CHECK ("status" IN ('Ativo', 'Inativo', 'Pendente'));
ALTER TABLE "Department" ADD CONSTRAINT "Department_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 60);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tipo_check" CHECK ("tipo" IN ('Servidor', 'Aplicacao', 'Rede', 'Banco de Dados'));
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_status_check" CHECK ("status" IN ('Ativo', 'Inativo'));
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_status_check" CHECK ("status" IN ('EM_FILA', 'EM_ANDAMENTO', 'CONCLUIDA'));
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_cvss_check" CHECK ("cvss" >= 0 AND "cvss" <= 10);
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_severidade_check" CHECK ("severidade" IN ('Baixo', 'Médio', 'Alto', 'Crítico'));
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_status_check" CHECK ("status" IN ('Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito'));
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_cwe_check" CHECK ("cwe" IS NULL OR "cwe" ~ '^CWE-[0-9]{1,5}$');
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_cve_check" CHECK ("cve" IS NULL OR "cve" ~ '^CVE-[0-9]{4}-[0-9]{4,7}$');
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_cvssVetor_check" CHECK ("cvssVetor" IS NULL OR "cvssVetor" LIKE 'CVSS:3.1/%');
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_remediacao_check" CHECK ("remediacao" IS NULL OR jsonb_typeof("remediacao") = 'array');
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_template_check" CHECK ("template" IN ('urgencia', 'autoridade', 'curiosidade'));
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_status_check" CHECK ("status" IN ('AGENDADA', 'ATIVA', 'ENCERRADA'));
