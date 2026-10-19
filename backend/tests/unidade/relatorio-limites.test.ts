// DT36 — limites do relatorio de vulnerabilidades, sem banco: o maior CVSS sai de um laco (o
// `Math.max(...notas)` estourava a pilha acima de ~123 mil achados e o PDF e o Excel davam 500),
// o teto de achados por exportacao (o ambiente so baixa, nunca afrouxa) e as mensagens das recusas.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dadosAchado } from '../../src/models/catalogoAchado.model.js';
import {
  MENSAGEM_EXPORTACAO_EM_ANDAMENTO,
  mensagemRelatorioGrande,
  TETO_ACHADOS_RELATORIO,
  tetoAchadosRelatorio,
  type FindingComScan,
} from '../../src/models/vulnerabilidade.model.js';
import { maximo, montarRelatorio } from '../../src/services/relatorioVulnerabilidade.service.js';

const AUTOR = { nome: 'Analista de Segurança', email: 'analista@empresa.com', perfil: 'Analista' };
const GRANDE = 300_000;

describe('maior CVSS sem espalhar a lista como argumentos', () => {
  it(`maximo() com ${GRANDE.toLocaleString('pt-BR')} notas não estoura a pilha (Math.max(...) estoura)`, () => {
    const notas = Array.from({ length: GRANDE }, (_, i) => (i % 97) / 10);
    notas[GRANDE - 7] = 9.9;
    assert.throws(() => Math.max(...notas), RangeError, 'o defeito do DT36: o espalhamento estoura a pilha');
    assert.equal(maximo(notas), 9.9);
  });

  it('maximo(): lista vazia é null; negativos e um item só', () => {
    assert.equal(maximo([]), null);
    assert.equal(maximo([4.3]), 4.3);
    assert.equal(maximo([-1, -3]), -1);
  });

  it(`montarRelatorio com ${GRANDE.toLocaleString('pt-BR')} achados calcula o máximo e a média`, () => {
    const base = dadosAchado('cors-curinga'); // 4,3
    const criadoEm = new Date('2026-10-01T12:00:00Z');
    const scan = { asset: { host: '10.0.0.1', nome: 'Servidor' } };
    const findings: FindingComScan[] = Array.from({ length: GRANDE }, (_, i) => ({ id: `f${i}`, ...base, status: 'Aberta', criadoEm, scan }));
    findings[123_456] = { ...findings[123_456], ...dadosAchado('injecao-sql') }; // 9,8
    const r = montarRelatorio(findings, {}, AUTOR);
    assert.equal(r.resumo.total, GRANDE);
    assert.equal(r.resumo.cvssMaximo, 9.8);
    assert.equal(r.resumo.cvssMedio, 4.3);
    assert.equal(r.achados[0].cvss, 9.8);
  });
});

describe('teto de achados por exportação', () => {
  const anterior = process.env.RELATORIO_TETO_ACHADOS;
  afterEach(() => {
    if (anterior === undefined) delete process.env.RELATORIO_TETO_ACHADOS;
    else process.env.RELATORIO_TETO_ACHADOS = anterior;
  });

  it('a constante de produção é 50.000', () => {
    assert.equal(TETO_ACHADOS_RELATORIO, 50_000);
  });

  it('sem variável (ou vazia, inválida, zero, negativa, decimal), vale a constante', () => {
    for (const v of [undefined, '', 'abc', '0', '-5', '12.5', 'Infinity']) {
      if (v === undefined) delete process.env.RELATORIO_TETO_ACHADOS;
      else process.env.RELATORIO_TETO_ACHADOS = v;
      assert.equal(tetoAchadosRelatorio(), TETO_ACHADOS_RELATORIO, `valor ${JSON.stringify(v)}`);
    }
  });

  it('a variável só baixa o teto: valor maior que a constante não afrouxa o limite', () => {
    process.env.RELATORIO_TETO_ACHADOS = '3';
    assert.equal(tetoAchadosRelatorio(), 3);
    process.env.RELATORIO_TETO_ACHADOS = '1000000';
    assert.equal(tetoAchadosRelatorio(), TETO_ACHADOS_RELATORIO);
  });

  it('as mensagens dizem o total, o máximo e o que fazer', () => {
    assert.equal(
      mensagemRelatorioGrande(123_750, 50_000),
      'O relatório teria 123.750 achados (máximo 50.000). Filtre por severidade, status ou ativo para gerar um relatório menor.',
    );
    assert.match(MENSAGEM_EXPORTACAO_EM_ANDAMENTO, /em andamento.*Tente de novo em instantes/);
  });
});
