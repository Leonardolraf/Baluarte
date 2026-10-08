-- B29 (RNF-002): cadeia de hash na trilha de auditoria, com verificacao de integridade
-- (detecta adulteracao) e retencao de 12 meses. So aditiva: nenhuma trava.
-- A trava no banco (UPDATE/DELETE/TRUNCATE recusados) e a migration
-- 20261008171000_auditoria_imutavel, que fica na branch feat/b29-trava ate o Leo decidir
-- aplica-la (e porta de mao unica). A retencao abaixo ja liga a variavel de sessao que o
-- trigger dela confere.
--
-- O que esta migration faz:
--   1. Colunas novas, aditivas: "sequencia" (ordem da cadeia), "hashAnterior" e "hash"
--      (hash e hashAnterior anulaveis; "sequencia" tem default. O codigo antigo continua
--      gravando sem conhecer nenhuma delas: o trigger preenche).
--   2. Backfill: os registros que ja existem entram na cadeia em ordem de "timestamp" e "id".
--      O primeiro fica com "hashAnterior" NULL (inicio da cadeia).
--   3. Trigger BEFORE INSERT: sob um advisory lock da transacao, le o hash do ultimo registro,
--      atribui a proxima "sequencia" e calcula "hash". E a UNICA fonte do hash: o que a
--      aplicacao mandar nessas tres colunas e sobrescrito.
--   4. Funcao de retencao (12 meses), que apaga so o prefixo antigo da cadeia.
--
-- Sem a trava, a aplicacao nunca altera nem apaga, mas o banco ainda aceita UPDATE/DELETE de
-- quem tiver a connection string; a verificacao (GET /api/auditoria/integridade) acusa.
--
-- Serializacao canonica do hash (v1):
--   mensagem = 'baluarte-auditoria-v1' || '|' || c(hashAnterior) || '|' || c(id) || '|' ||
--              c(usuarioId) || '|' || c(acao) || '|' || c(detalhe) || '|' || c(timestamp ISO)
--   c(NULL)  = '-'
--   c(texto) = <tamanho em bytes UTF-8> || ':' || texto
--   timestamp ISO = 'AAAA-MM-DDTHH:MM:SS.mmmZ' (UTC, milissegundos, igual ao toISOString do JS)
--   hash = hex minusculo de sha256(mensagem em UTF-8)
-- O prefixo de tamanho torna a concatenacao inequivoca ('a|b' + 'c' nao colide com 'a' + 'b|c').
--
-- Limite honesto: a verificacao acusa a mudanca no registro alterado ou no seguinte, mas o
-- hash nao tem chave secreta: quem reescreve a cadeia inteira a partir do ponto alterado
-- (DBA) nao e detectado sem uma ancora externa.

-- 1. Colunas novas -----------------------------------------------------------------------
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT,
ADD COLUMN "hashAnterior" TEXT,
ADD COLUMN "sequencia" BIGINT;

-- Mesmo resultado de um BIGSERIAL (o Prisma le como autoincrement()), mas preenchido em ordem
-- de timestamp e id, e nao na ordem fisica das linhas.
CREATE SEQUENCE "AuditLog_sequencia_seq" OWNED BY "AuditLog"."sequencia";

UPDATE "AuditLog" AS a
SET "sequencia" = o.n
FROM (SELECT "id", row_number() OVER (ORDER BY "timestamp", "id") AS n FROM "AuditLog") AS o
WHERE a."id" = o."id";

SELECT setval('"AuditLog_sequencia_seq"', COALESCE((SELECT max("sequencia") FROM "AuditLog"), 0) + 1, false);

ALTER TABLE "AuditLog" ALTER COLUMN "sequencia" SET DEFAULT nextval('"AuditLog_sequencia_seq"'),
ALTER COLUMN "sequencia" SET NOT NULL;

-- 2. Hash (fonte unica: o trigger de INSERT e a verificacao da API usam esta funcao) -----
CREATE FUNCTION auditoria_campo(valor TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN valor IS NULL THEN '-'
              ELSE octet_length(convert_to(valor, 'UTF8'))::text || ':' || valor END
$$;

CREATE FUNCTION auditoria_calcular_hash(
  hash_anterior TEXT, id TEXT, usuario_id TEXT, acao TEXT, detalhe TEXT, quando TIMESTAMP
) RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(
    'baluarte-auditoria-v1'
    || '|' || auditoria_campo(hash_anterior)
    || '|' || auditoria_campo(id)
    || '|' || auditoria_campo(usuario_id)
    || '|' || auditoria_campo(acao)
    || '|' || auditoria_campo(detalhe)
    || '|' || auditoria_campo(to_char(quando, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'UTF8')), 'hex')
$$;

-- 3. Backfill da cadeia, na ordem da sequencia (= timestamp, id) --------------------------
DO $$
DECLARE
  r RECORD;
  anterior TEXT := NULL;
  atual TEXT;
BEGIN
  FOR r IN SELECT "id", "usuarioId", "acao", "detalhe", "timestamp" FROM "AuditLog" ORDER BY "sequencia" LOOP
    atual := auditoria_calcular_hash(anterior, r."id", r."usuarioId", r."acao", r."detalhe", r."timestamp");
    UPDATE "AuditLog" SET "hashAnterior" = anterior, "hash" = atual WHERE "id" = r."id";
    anterior := atual;
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_sequencia_key" ON "AuditLog"("sequencia");

-- CreateIndex (duas linhas com o mesmo anterior seriam uma bifurcacao da cadeia)
CREATE UNIQUE INDEX "AuditLog_hashAnterior_key" ON "AuditLog"("hashAnterior");

-- 4. Encadeamento na insercao -------------------------------------------------------------
-- O advisory lock da transacao serializa as insercoes: duas gravacoes concorrentes nunca
-- leem o mesmo "ultimo hash" (o lock so e solto no COMMIT/ROLLBACK, e cada comando do
-- PL/pgSQL em READ COMMITTED enxerga o que ja foi confirmado). A "sequencia" e tirada
-- depois do lock, entao a ordem da sequencia e a ordem da cadeia.
CREATE FUNCTION auditoria_encadear() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  anterior TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('baluarte.AuditLog'));
  SELECT "hash" INTO anterior FROM "AuditLog" ORDER BY "sequencia" DESC LIMIT 1;
  NEW."sequencia" := nextval('"AuditLog_sequencia_seq"');
  NEW."hashAnterior" := anterior;
  NEW."hash" := auditoria_calcular_hash(anterior, NEW."id", NEW."usuarioId", NEW."acao", NEW."detalhe", NEW."timestamp");
  RETURN NEW;
END $$;

CREATE TRIGGER "AuditLog_encadear"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION auditoria_encadear();

-- 5. Retencao -------------------------------------------------------------------------------
-- Apaga so o PREFIXO da cadeia mais antigo que o corte: tudo antes do primeiro registro
-- recente (na ordem da sequencia). Assim a cadeia restante continua contigua e o primeiro
-- registro que sobra vira a ancora (o "hashAnterior" dele aponta para o ultimo apagado,
-- devolvido em "ancora"). Um registro antigo gravado depois de um recente (timestamp
-- explicito, ou concorrencia de milissegundos na virada) espera a proxima execucao.
-- A variavel baluarte.retencao (local a transacao) e o que o trigger da trava
-- (feat/b29-trava) confere para deixar esta exclusao passar; sem a trava, nao tem efeito.
-- SECURITY DEFINER: num papel de aplicacao sem DELETE no AuditLog, a retencao continua
-- possivel so por esta funcao. search_path fixo, como pede o SECURITY DEFINER.
CREATE FUNCTION auditoria_aplicar_retencao(meses INTEGER)
RETURNS TABLE (apagados BIGINT, corte TIMESTAMP(3), ancora TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  primeira_recente BIGINT;
BEGIN
  IF meses IS NULL OR meses < 12 THEN
    RAISE EXCEPTION 'Retencao minima da auditoria e de 12 meses (pedido: %)', meses;
  END IF;
  corte := (now() AT TIME ZONE 'UTC') - make_interval(months => meses);
  -- Mesmo lock das insercoes: ninguem encadeia num registro que esta sendo apagado.
  PERFORM pg_advisory_xact_lock(hashtext('baluarte.AuditLog'));
  SELECT min("sequencia") INTO primeira_recente FROM "AuditLog" WHERE "timestamp" >= corte;
  SELECT "hash" INTO ancora FROM "AuditLog"
  WHERE "timestamp" < corte AND (primeira_recente IS NULL OR "sequencia" < primeira_recente)
  ORDER BY "sequencia" DESC LIMIT 1;

  PERFORM set_config('baluarte.retencao', 'on', true);
  DELETE FROM "AuditLog"
  WHERE "timestamp" < corte AND (primeira_recente IS NULL OR "sequencia" < primeira_recente);
  GET DIAGNOSTICS apagados = ROW_COUNT;
  PERFORM set_config('baluarte.retencao', 'off', true);
  RETURN NEXT;
END $$;

-- Funcao SECURITY DEFINER nao fica executavel por qualquer papel. No Supabase, anon e
-- authenticated (expostos pela API REST, inclusive /rpc) tambem perdem o EXECUTE.
REVOKE ALL ON FUNCTION auditoria_aplicar_retencao(INTEGER) FROM PUBLIC;
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION auditoria_aplicar_retencao(INTEGER) FROM %I', papel);
    END IF;
  END LOOP;
END $$;
