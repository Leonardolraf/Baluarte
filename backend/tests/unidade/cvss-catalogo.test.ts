// Testes de UNIDADE (sem banco, sem servidor): calculo CVSS 3.1, validacao de CWE/CVE,
// catalogo de achados e ciclo da varredura simulada.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cveValido, cweValido, notaCvss, vetorCvssValido } from '../../src/cvss.js';
import { CATALOGO_ACHADOS, dadosAchado, lerRemediacao, type ChaveAchado } from '../../src/catalogo.js';
import { DURACAO_VARREDURA_MS, TEMPO_EM_FILA_MS, gerarFindings, statusPorTempo } from '../../src/varredura.js';
import { faixaCvss } from '../../src/util.js';

describe('notaCvss: nota base CVSS v3.1 (valores da calculadora oficial do FIRST)', () => {
  const casos: [string, number][] = [
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10.0],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
    ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 7.8],
    ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N', 6.5],
    ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N', 5.9],
    ['CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N', 1.6],
  ];
  for (const [vetor, nota] of casos) {
    it(`${vetor} -> ${nota}`, () => assert.equal(notaCvss(vetor), nota));
  }

  it('sem impacto (C/I/A = N) a nota é 0', () => {
    assert.equal(notaCvss('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N'), 0);
  });

  it('a ordem das métricas não importa', () => {
    assert.equal(notaCvss('CVSS:3.1/A:H/I:H/C:H/S:U/UI:N/PR:N/AC:L/AV:N'), 9.8);
  });

  it('vetor inválido -> null (versão errada, métrica faltando, repetida, desconhecida ou valor fora da lista)', () => {
    for (const v of [
      'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H',
      'CVSS:3.1/AV:N/AV:N/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/XX:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      '',
    ]) {
      assert.equal(notaCvss(v), null, v);
      assert.equal(vetorCvssValido(v), false, v);
    }
    assert.equal(vetorCvssValido(42), false);
  });
});

describe('faixaCvss: severidade pela nota', () => {
  it('limites das faixas', () => {
    assert.equal(faixaCvss(0), 'Baixo');
    assert.equal(faixaCvss(3.9), 'Baixo');
    assert.equal(faixaCvss(4.0), 'Médio');
    assert.equal(faixaCvss(6.9), 'Médio');
    assert.equal(faixaCvss(7.0), 'Alto');
    assert.equal(faixaCvss(8.9), 'Alto');
    assert.equal(faixaCvss(9.0), 'Crítico');
    assert.equal(faixaCvss(10), 'Crítico');
  });
});

describe('cweValido / cveValido', () => {
  it('aceita os formatos oficiais', () => {
    assert.ok(cweValido('CWE-79'));
    assert.ok(cweValido('CWE-12345'));
    assert.ok(cveValido('CVE-2021-44228'));
    assert.ok(cveValido('CVE-2024-1234567'));
  });
  it('recusa o resto', () => {
    for (const v of ['CWE-', 'cwe-79', 'CWE-123456', 'CWE-7a', 79, null]) assert.equal(cweValido(v), false, String(v));
    for (const v of ['CVE-21-1234', 'CVE-2021-123', 'CVE-2021-12345678', 'cve-2021-44228', undefined]) assert.equal(cveValido(v), false, String(v));
  });
});

describe('catálogo de achados', () => {
  const chaves = Object.keys(CATALOGO_ACHADOS) as ChaveAchado[];

  it('todo item do catálogo gera um achado consistente (nota do vetor, severidade da nota)', () => {
    assert.ok(chaves.length >= 6);
    for (const chave of chaves) {
      const a = dadosAchado(chave);
      assert.equal(a.cvss, notaCvss(a.cvssVetor), chave);
      assert.equal(a.severidade, faixaCvss(a.cvss), chave);
      assert.ok(cweValido(a.cwe), chave);
      assert.ok(a.cve === null || cveValido(a.cve), chave);
      assert.ok(lerRemediacao(a.remediacao).length > 0, `${chave} sem passos de remediação`);
    }
  });

  it('lerRemediacao numera os passos e descarta os fora do formato', () => {
    const passos = lerRemediacao([
      { titulo: 'A', descricao: 'a', esforco: 'baixo' },
      { titulo: 'B', descricao: 'b', esforco: 'impossivel' },
      null,
      { titulo: 'C', descricao: 'c', esforco: 'alto' },
    ]);
    assert.deepEqual(passos.map((p) => [p.ordem, p.titulo]), [[1, 'A'], [2, 'C']]);
    assert.deepEqual(lerRemediacao('nao e lista'), []);
    assert.deepEqual(lerRemediacao(null), []);
  });
});

describe('varredura simulada', () => {
  const criado = new Date('2026-10-08T12:00:00Z');
  const depois = (ms: number) => new Date(criado.getTime() + ms);

  it('statusPorTempo: fila, andamento e concluída nos limites', () => {
    assert.equal(statusPorTempo(criado, criado), 'EM_FILA');
    assert.equal(statusPorTempo(criado, depois(TEMPO_EM_FILA_MS - 1)), 'EM_FILA');
    assert.equal(statusPorTempo(criado, depois(TEMPO_EM_FILA_MS)), 'EM_ANDAMENTO');
    assert.equal(statusPorTempo(criado, depois(DURACAO_VARREDURA_MS - 1)), 'EM_ANDAMENTO');
    assert.equal(statusPorTempo(criado, depois(DURACAO_VARREDURA_MS)), 'CONCLUIDA');
    assert.equal(statusPorTempo(criado, depois(3600_000)), 'CONCLUIDA');
  });

  it('gerarFindings sorteia de 2 a 4 tipos distintos do catálogo', () => {
    for (let i = 0; i < 50; i++) {
      const achados = gerarFindings();
      assert.ok(achados.length >= 2 && achados.length <= 4, `veio ${achados.length}`);
      assert.equal(new Set(achados.map((a) => a.cvssVetor + a.cwe)).size, achados.length, 'sem repetição');
    }
  });
});
