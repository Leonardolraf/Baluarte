// Testes de UNIDADE (sem banco, sem servidor) do progresso da varredura simulada (B26):
// percentual, etapa e estimativa derivados de `criadoEm` e das constantes do ciclo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DURACAO_VARREDURA_MS,
  ETAPA_CONCLUIDA,
  ETAPA_FILA,
  ETAPAS_ANDAMENTO,
  TEMPO_EM_FILA_MS,
  progressoDaVarredura,
  progressoPorTempo,
} from '../../src/services/cicloVarredura.service.js';
import { CONSULTA } from '../../src/models/varredura.model.js';
import { ErroNegocio } from '../../src/utils/resposta.js';
import { validar } from '../../src/utils/esquemas.js';

const criado = new Date('2026-10-08T12:00:00Z');
const depois = (ms: number) => new Date(criado.getTime() + ms);
const ANDAMENTO_MS = DURACAO_VARREDURA_MS - TEMPO_EM_FILA_MS;
const PREVISTO = depois(DURACAO_VARREDURA_MS).toISOString();

describe('progressoPorTempo: bordas do ciclo', () => {
  it('0 s: na fila, 0%, conclusão prevista para criação + duração', () => {
    assert.deepEqual(progressoPorTempo(criado, criado), {
      status: 'EM_FILA',
      progresso: 0,
      etapa: ETAPA_FILA,
      estimativaConclusao: PREVISTO,
    });
  });

  it('um instante antes de 5 s ainda é fila com 0%', () => {
    const p = progressoPorTempo(criado, depois(TEMPO_EM_FILA_MS - 1));
    assert.equal(p.status, 'EM_FILA');
    assert.equal(p.progresso, 0);
  });

  it('5 s: começa o andamento, com 1% e a primeira etapa (nunca 0% em andamento)', () => {
    const p = progressoPorTempo(criado, depois(TEMPO_EM_FILA_MS));
    assert.equal(p.status, 'EM_ANDAMENTO');
    assert.equal(p.progresso, 1);
    assert.equal(p.etapa, ETAPAS_ANDAMENTO[0]);
    assert.equal(p.estimativaConclusao, PREVISTO);
  });

  it('meio do andamento: 50% e a terceira etapa', () => {
    const p = progressoPorTempo(criado, depois(TEMPO_EM_FILA_MS + ANDAMENTO_MS / 2));
    assert.equal(p.status, 'EM_ANDAMENTO');
    assert.equal(p.progresso, 50);
    assert.equal(p.etapa, 'Testando autenticação');
  });

  it('um instante antes de 20 s: 99% e "Gerando relatório" (só a conclusão é 100%)', () => {
    const p = progressoPorTempo(criado, depois(DURACAO_VARREDURA_MS - 1));
    assert.equal(p.status, 'EM_ANDAMENTO');
    assert.equal(p.progresso, 99);
    assert.equal(p.etapa, 'Gerando relatório');
  });

  it('20 s e depois: concluída, 100%', () => {
    for (const ms of [DURACAO_VARREDURA_MS, DURACAO_VARREDURA_MS + 1, 3_600_000]) {
      assert.deepEqual(progressoPorTempo(criado, depois(ms)), {
        status: 'CONCLUIDA',
        progresso: 100,
        etapa: ETAPA_CONCLUIDA,
        estimativaConclusao: PREVISTO,
      });
    }
  });

  it('as etapas se distribuem por igual no andamento e o progresso nunca diminui', () => {
    const fatia = ANDAMENTO_MS / ETAPAS_ANDAMENTO.length;
    ETAPAS_ANDAMENTO.forEach((etapa, i) => {
      assert.equal(progressoPorTempo(criado, depois(TEMPO_EM_FILA_MS + i * fatia)).etapa, etapa, `início da etapa ${i}`);
      assert.equal(progressoPorTempo(criado, depois(TEMPO_EM_FILA_MS + (i + 1) * fatia - 1)).etapa, etapa, `fim da etapa ${i}`);
    });
    let anterior = -1;
    for (let ms = 0; ms <= DURACAO_VARREDURA_MS + 1_000; ms += 250) {
      const { progresso } = progressoPorTempo(criado, depois(ms));
      assert.ok(progresso >= anterior, `${ms} ms: ${progresso} < ${anterior}`);
      assert.ok(Number.isInteger(progresso) && progresso >= 0 && progresso <= 100);
      anterior = progresso;
    }
  });

  it('relógio antes da criação (criada por outra instância) conta como fila', () => {
    assert.equal(progressoPorTempo(criado, depois(-2_000)).progresso, 0);
  });
});

describe('progressoDaVarredura: coerente com o status gravado', () => {
  it('concluída é 100%, com a data real de conclusão como estimativa', () => {
    const concluidoEm = depois(DURACAO_VARREDURA_MS);
    assert.deepEqual(progressoDaVarredura({ status: 'CONCLUIDA', criadoEm: criado, concluidoEm }, depois(DURACAO_VARREDURA_MS + 5)), {
      progresso: 100,
      etapa: ETAPA_CONCLUIDA,
      estimativaConclusao: concluidoEm.toISOString(),
    });
  });

  it('concluída logo ao nascer (seed:demo) continua 100%, mesmo com pouco tempo decorrido', () => {
    const p = progressoDaVarredura({ status: 'CONCLUIDA', criadoEm: criado, concluidoEm: criado }, depois(1_000));
    assert.equal(p.progresso, 100);
    assert.equal(p.estimativaConclusao, criado.toISOString());
  });

  it('concluída sem data de conclusão usa a prevista', () => {
    assert.equal(progressoDaVarredura({ status: 'CONCLUIDA', criadoEm: criado, concluidoEm: null }).estimativaConclusao, PREVISTO);
  });

  it('em fila gravada é 0%, e em andamento gravada nunca passa de 99% nem fica em 0%', () => {
    const fila = progressoDaVarredura({ status: 'EM_FILA', criadoEm: criado, concluidoEm: null }, depois(2_000));
    assert.deepEqual(fila, { progresso: 0, etapa: ETAPA_FILA, estimativaConclusao: PREVISTO });

    const tarde = progressoDaVarredura({ status: 'EM_ANDAMENTO', criadoEm: criado, concluidoEm: null }, depois(DURACAO_VARREDURA_MS + 60_000));
    assert.equal(tarde.progresso, 99, 'status ainda não gravado como concluído: não promete 100%');
    assert.equal(tarde.etapa, 'Gerando relatório');

    const cedo = progressoDaVarredura({ status: 'EM_ANDAMENTO', criadoEm: criado, concluidoEm: null }, depois(1_000));
    assert.equal(cedo.progresso, 1);
    assert.equal(cedo.etapa, ETAPAS_ANDAMENTO[0]);
  });

  it('acompanha o tempo dentro do andamento', () => {
    const p = progressoDaVarredura(
      { status: 'EM_ANDAMENTO', criadoEm: criado, concluidoEm: null },
      depois(TEMPO_EM_FILA_MS + ANDAMENTO_MS / 4),
    );
    assert.equal(p.progresso, 25);
    assert.equal(p.etapa, 'Testando injeção');
  });
});

describe('GET /scans/:id: regra do parâmetro', () => {
  const recusa = (id: unknown) =>
    assert.throws(() => validar({ id }, CONSULTA), (e: unknown) => e instanceof ErroNegocio && e.status === 400 && e.codigo === 'VARREDURA_ID_INVALIDO');

  it('aceita cuid e id legível', () => {
    for (const id of ['cm1abcdefghijklmnopqrstuv', 'scan-001', 'a_b']) assert.doesNotThrow(() => validar({ id }, CONSULTA));
  });

  it('recusa vazio, longo demais e caracteres fora do formato', () => {
    for (const id of ['', 'x'.repeat(65), "1' OR '1'='1", 'a.b', '../etc', 'a b', '%00', undefined, 123]) recusa(id);
  });
});
