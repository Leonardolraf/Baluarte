// Testes de UNIDADE (sem banco): o texto servido do aviso de monitoramento esta preso a versao.
// A ciencia e por versao (VERSAO_AVISO); se o texto servido mudar sem a versao mudar, quem
// registrou a ciencia da versao fica com ciencia de um texto que nao e mais o servido. O caso
// mais facil de passar despercebido: as frequencias saem do agendamento da coleta
// (FATOR_INTERVALO e INTERVALO_PRODUCAO_S em models/agente.model.ts), entao mudar o agendamento
// muda o texto sozinho. Este teste recalcula o SHA-256 do texto servido e o compara com
// HASH_TEXTO_AVISO, gravado ao lado da versao.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { HASH_TEXTO_AVISO, TEXTO_AVISO, VERSAO_AVISO, hashDoTextoAviso, serializarTextoAviso, versaoAviso } = await import(
  '../../src/models/avisoMonitoramento.model.js'
);

const MENSAGEM =
  'o texto do aviso mudou (por exemplo, por mudança no agendamento da coleta): suba VERSAO_AVISO e atualize HASH_TEXTO_AVISO; a ciência é por versão';

describe('HASH_TEXTO_AVISO', () => {
  it('é o SHA-256 do texto servido nesta versão', () => {
    assert.equal(hashDoTextoAviso(), HASH_TEXTO_AVISO, MENSAGEM);
  });

  it('a versão segue o formato aceito pela rota e pela CHECK do banco', () => {
    assert.ok(versaoAviso.safeParse(VERSAO_AVISO).success);
    assert.match(HASH_TEXTO_AVISO, /^[0-9a-f]{64}$/);
  });

  it('a serialização é determinística: a ordem das chaves não muda o hash, a das listas sim', () => {
    const invertido = Object.fromEntries(Object.entries(TEXTO_AVISO).reverse()) as typeof TEXTO_AVISO;
    assert.equal(serializarTextoAviso(invertido), serializarTextoAviso(TEXTO_AVISO));
    assert.equal(
      hashDoTextoAviso(),
      createHash('sha256').update(serializarTextoAviso(TEXTO_AVISO), 'utf8').digest('hex'),
    );
    const outraOrdem = { ...TEXTO_AVISO, secoes: [...TEXTO_AVISO.secoes].reverse() };
    assert.notEqual(hashDoTextoAviso(outraOrdem), HASH_TEXTO_AVISO);
  });

  it('qualquer mudança de texto (uma letra numa frase) muda o hash', () => {
    const [primeira, ...resto] = TEXTO_AVISO.secoes;
    const alterado = { ...TEXTO_AVISO, secoes: [{ ...primeira, titulo: primeira.titulo + '.' }, ...resto] };
    assert.notEqual(hashDoTextoAviso(alterado), HASH_TEXTO_AVISO);
  });
});
