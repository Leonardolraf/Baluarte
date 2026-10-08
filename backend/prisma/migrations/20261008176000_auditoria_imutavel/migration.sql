-- B29 (RNF-002), parte 2 de 2: trava no banco. Depende de 20261008170000_auditoria_cadeia_hash.
--
-- Triggers BEFORE UPDATE/DELETE e BEFORE TRUNCATE recusam qualquer alteracao ou exclusao
-- no AuditLog. A unica excecao e a retencao: auditoria_aplicar_retencao() liga a variavel
-- de sessao baluarte.retencao (set_config local a transacao) e, mesmo com ela ligada, o
-- trigger so deixa sair registro com mais de 12 meses.
--
-- PORTA DE MAO UNICA: depois desta migration ninguem limpa o AuditLog pela aplicacao nem
-- por SQL comum, nem para arrumar dado de demonstracao. So a retencao (mais de 12 meses)
-- apaga. Desfazer exige o dono da tabela/superusuario desligando os triggers de proposito.
--
-- Limite honesto: protege contra alteracao pela aplicacao e por erro, nao contra o DBA. Um
-- superusuario (ou o dono da tabela, com ALTER TABLE ... DISABLE TRIGGER) consegue desligar
-- os triggers. Hoje a API conecta com o mesmo papel dono das tabelas; separar um papel so de
-- aplicacao (sem ALTER, UPDATE, DELETE e TRUNCATE no AuditLog) e o proximo endurecimento.

-- So insercao ------------------------------------------------------------------------------
CREATE FUNCTION auditoria_bloquear_alteracao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Unica excecao: a retencao, que liga baluarte.retencao so dentro da propria transacao.
  -- Mesmo com a variavel ligada, registro com 12 meses ou menos nao sai (piso da politica).
  IF TG_OP = 'DELETE' AND current_setting('baluarte.retencao', true) = 'on' THEN
    IF OLD."timestamp" < (now() AT TIME ZONE 'UTC') - interval '12 months' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog e somente insercao: % recusado', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Registros de auditoria nao sao alterados nem apagados; a retencao de 12 meses usa auditoria_aplicar_retencao().';
END $$;

CREATE TRIGGER "AuditLog_somente_insercao"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION auditoria_bloquear_alteracao();

CREATE FUNCTION auditoria_bloquear_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog e somente insercao: TRUNCATE recusado'
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "AuditLog_sem_truncate"
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION auditoria_bloquear_truncate();
