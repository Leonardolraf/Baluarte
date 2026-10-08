-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "descricao" TEXT,
ADD COLUMN     "ip" TEXT;


-- Escrito a mao (o Prisma nao modela CHECK). Mesmas regras do zod em src/utils/esquemas.ts
-- (B10): IP opcional em IPv4 com octetos de 0 a 255 (ate 3 digitos, como o zod aceita) e
-- descricao opcional de ate 500 caracteres.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ip_check" CHECK ("ip" IS NULL OR "ip" ~ '^((25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])$');
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_descricao_check" CHECK ("descricao" IS NULL OR length("descricao") <= 500);
