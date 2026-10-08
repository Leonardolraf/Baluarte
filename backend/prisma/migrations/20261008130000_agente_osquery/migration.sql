-- CreateTable
CREATE TABLE "Workstation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "hostIdentifier" TEXT NOT NULL,
    "nodeKeyHash" TEXT NOT NULL,
    "sistema" TEXT NOT NULL,
    "soNome" TEXT,
    "soVersao" TEXT,
    "soBuild" TEXT,
    "soPlataforma" TEXT,
    "inscritaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inventarioEm" TIMESTAMP(3),

    CONSTRAINT "Workstation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkstationSoftware" (
    "id" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "versao" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "fornecedor" TEXT,
    "coletadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkstationSoftware_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkstationPort" (
    "id" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "porta" INTEGER NOT NULL,
    "protocolo" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "processo" TEXT,
    "coletadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkstationPort_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workstation_assetId_key" ON "Workstation"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Workstation_hostIdentifier_key" ON "Workstation"("hostIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Workstation_nodeKeyHash_key" ON "Workstation"("nodeKeyHash");

-- CreateIndex
CREATE INDEX "WorkstationSoftware_nome_idx" ON "WorkstationSoftware"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "WorkstationSoftware_workstationId_fonte_nome_versao_key" ON "WorkstationSoftware"("workstationId", "fonte", "nome", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "WorkstationPort_workstationId_porta_protocolo_endereco_key" ON "WorkstationPort"("workstationId", "porta", "protocolo", "endereco");

-- AddForeignKey
ALTER TABLE "Workstation" ADD CONSTRAINT "Workstation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstationSoftware" ADD CONSTRAINT "WorkstationSoftware_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkstationPort" ADD CONSTRAINT "WorkstationPort_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Escrito a mao (o Prisma nao modela CHECK nem RLS).
-- Novo tipo de ativo: so a inscricao do agente osquery cria ativos deste tipo.
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_tipo_check";
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tipo_check" CHECK ("tipo" IN ('Servidor', 'Aplicacao', 'Rede', 'Banco de Dados', 'Estação de trabalho'));

ALTER TABLE "Workstation" ADD CONSTRAINT "Workstation_hostIdentifier_check" CHECK (length("hostIdentifier") BETWEEN 1 AND 255);
ALTER TABLE "Workstation" ADD CONSTRAINT "Workstation_nodeKeyHash_check" CHECK ("nodeKeyHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Workstation" ADD CONSTRAINT "Workstation_sistema_check" CHECK (length("sistema") BETWEEN 1 AND 255);
ALTER TABLE "WorkstationSoftware" ADD CONSTRAINT "WorkstationSoftware_fonte_check" CHECK ("fonte" IN ('programs', 'deb_packages', 'rpm_packages', 'apps'));
ALTER TABLE "WorkstationSoftware" ADD CONSTRAINT "WorkstationSoftware_nome_check" CHECK (length("nome") BETWEEN 1 AND 512);
ALTER TABLE "WorkstationSoftware" ADD CONSTRAINT "WorkstationSoftware_versao_check" CHECK (length("versao") <= 255);
ALTER TABLE "WorkstationPort" ADD CONSTRAINT "WorkstationPort_porta_check" CHECK ("porta" BETWEEN 1 AND 65535);
ALTER TABLE "WorkstationPort" ADD CONSTRAINT "WorkstationPort_protocolo_check" CHECK ("protocolo" IN ('TCP', 'UDP'));

-- Mesma regra da migration habilita_rls: tabela nova nasce com RLS e sem politicas.
ALTER TABLE "Workstation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationSoftware" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationPort" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "Workstation", "WorkstationSoftware", "WorkstationPort" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
