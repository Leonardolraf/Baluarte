-- #9: vinculo de inscricao da estacao (StationEnrollmentBinding). Codigo de uso unico que o
-- Administrador emite no painel; o operador cola no instalador; o codigo E o enroll_secret da
-- estacao (o osquery nao tem campo livre no enroll). No enroll o codigo e consumido (uso unico,
-- TTL 24h) e o ativo-estacao nasce com os metadados da emissao. So aditiva. So guarda o HASH do
-- codigo (como o node_key e o token de reset). usuarioId/criadoPorId/assetId sao id simples, SEM
-- FK (como o autor do AuditLog): a linha e um registro historico e sobrevive a exclusao.

-- CreateTable
CREATE TABLE "StationEnrollmentBinding" (
    "id" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "host" TEXT,
    "ip" TEXT,
    "descricao" TEXT,
    "usuarioId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "consumidoEm" TIMESTAMP(3),
    "assetId" TEXT,

    CONSTRAINT "StationEnrollmentBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StationEnrollmentBinding_codigoHash_key" ON "StationEnrollmentBinding"("codigoHash");

-- CreateIndex
CREATE INDEX "StationEnrollmentBinding_expiraEm_idx" ON "StationEnrollmentBinding"("expiraEm");

-- Escrito a mao (o Prisma nao modela CHECK nem RLS).
-- ip: a validacao de formato (IPv4) e do zod na emissao; aqui so um teto de tamanho de seguranca
-- (45 cobre ate IPv6). descricao: o mesmo teto do ativo (500).
ALTER TABLE "StationEnrollmentBinding" ADD CONSTRAINT "StationEnrollmentBinding_ip_check"
  CHECK ("ip" IS NULL OR (char_length("ip") BETWEEN 1 AND 45));
ALTER TABLE "StationEnrollmentBinding" ADD CONSTRAINT "StationEnrollmentBinding_descricao_check"
  CHECK ("descricao" IS NULL OR (char_length("descricao") BETWEEN 1 AND 500));

-- RLS sem politicas: so o dono das tabelas (a API) le e escreve.
ALTER TABLE "StationEnrollmentBinding" ENABLE ROW LEVEL SECURITY;

-- DT13: objeto novo nasce fechado para a API REST do Supabase (o RLS nao barra TRUNCATE).
-- Os papeis so existem no Supabase.
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "StationEnrollmentBinding" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
