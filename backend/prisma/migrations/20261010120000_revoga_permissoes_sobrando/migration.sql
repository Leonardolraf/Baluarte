-- DT13: permissoes que sobraram para os papeis da API REST do Supabase (anon, authenticated).
-- Migration so aditiva: nao cria nem altera objeto, so revoga permissao. Pode rodar de novo.
--
-- Conferido no Supabase em 10/10/2026 (consulta so de leitura com has_*_privilege):
-- 1. "ResetRequest" (migration limite_reset_no_banco) ligou o RLS mas nao revogou nada: anon e
--    authenticated tinham tudo, inclusive TRUNCATE, que o RLS nao barra (e permissao de tabela,
--    nao de linha). As tabelas criadas depois revogaram as suas; esta ficou para tras.
-- 2. A sequence "AuditLog_sequencia_seq" (auditoria_cadeia_hash) ficou com USAGE/SELECT/UPDATE:
--    um setval/nextval de fora abriria buraco na sequencia da trilha, que parece registro apagado.
-- 3. auditoria_campo, auditoria_calcular_hash e auditoria_encadear ficaram executaveis por
--    PUBLIC, anon e authenticated (o padrao do Postgres e do Supabase para funcao nova). O
--    trigger e a verificacao de integridade rodam como o dono das tabelas (a API), que nao
--    precisa de permissao explicita; a auditoria_aplicar_retencao ja tinha sido fechada.
--
-- Um unico bloco DO, para o teste (tests/permissoes-papeis.test.ts) reaplicar o arquivo inteiro
-- numa transacao com papeis anon/authenticated simulados. Os papeis so existem no Supabase.
DO $$
DECLARE papel text;
BEGIN
  REVOKE ALL ON FUNCTION auditoria_campo(TEXT) FROM PUBLIC;
  REVOKE ALL ON FUNCTION auditoria_calcular_hash(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMP) FROM PUBLIC;
  REVOKE ALL ON FUNCTION auditoria_encadear() FROM PUBLIC;
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON "ResetRequest" FROM %I', papel);
      EXECUTE format('REVOKE ALL ON SEQUENCE "AuditLog_sequencia_seq" FROM %I', papel);
      EXECUTE format('REVOKE ALL ON FUNCTION auditoria_campo(TEXT), '
        || 'auditoria_calcular_hash(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMP), '
        || 'auditoria_encadear() FROM %I', papel);
    END IF;
  END LOOP;
END $$;
