-- B29, correcao: a "sequencia" do AuditLog pulava de 2 em 2.
--
-- A migration 20261008170000_auditoria_cadeia_hash deixou a coluna com
-- DEFAULT nextval('"AuditLog_sequencia_seq"') (o autoincrement() do Prisma) e o trigger
-- auditoria_encadear() tambem faz NEW."sequencia" := nextval(...). O default e avaliado antes
-- do trigger, entao cada INSERT queimava dois numeros: 2, 4, 6... A cadeia de hash nao era
-- afetada (a sequencia nao entra no hash), mas um buraco na sequencia parece registro apagado.
--
-- Correcao: o default vira a constante 0. Quem atribui a sequencia continua sendo so o trigger,
-- dentro do advisory lock (a ordem da sequencia precisa ser a ordem da cadeia). O 0 nunca chega
-- a ser gravado: o trigger sempre sobrescreve.
--
-- A sequence fica (o trigger a usa), mas sem dono: com OWNED BY na coluna o Prisma a trata
-- como autoincrement e, com o default 0 no schema, o migrate diff pediria DROP SEQUENCE.
-- Os saltos ja gravados ficam como estao (registros existentes nao sao renumerados).
ALTER TABLE "AuditLog" ALTER COLUMN "sequencia" SET DEFAULT 0;
ALTER SEQUENCE "AuditLog_sequencia_seq" OWNED BY NONE;
