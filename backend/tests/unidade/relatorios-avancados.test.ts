// B25, sem banco: nota de risco do ativo (formula, teto, ordem do ranking), regra de historico
// completo (B25b: a leitura do formato da auditoria passou para o backfill da migration, testado
// em tests/migracao-historico.test.ts) e as regras de paginacao compartilhadas (lista de
// vulnerabilidades e auditoria).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOTA_RISCO_MAXIMA } from '../../src/models/ativo.model.js';
import { PESO_SEVERIDADE } from '../../src/models/dominio.model.js';
import { CONSULTA_LISTA } from '../../src/models/vulnerabilidade.model.js';
import {
  abertosVazio,
  compararRisco,
  notaDeRisco,
  pontosDeRisco,
  riscoDe,
} from '../../src/services/riscoAtivo.service.js';
import { historicoCompleto } from '../../src/services/vulnerabilidade.service.js';
import { ErroNegocio } from '../../src/utils/resposta.js';
import { validar } from '../../src/utils/esquemas.js';

const abertos = (c: number, a: number, m: number, b: number) => ({ 'Crítico': c, 'Alto': a, 'Médio': m, 'Baixo': b });

describe('nota de risco do ativo', () => {
  it('pesos = piso da faixa CVSS 3.1 de cada severidade (proposta pendente do DT07; trocar = mudar só a constante)', () => {
    assert.deepEqual(PESO_SEVERIDADE, { 'Crítico': 10, 'Alto': 7, 'Médio': 4, 'Baixo': 1 });
  });

  it('soma ponderada dos abertos, com teto 100', () => {
    assert.equal(notaDeRisco(abertosVazio()), 0);
    assert.equal(notaDeRisco(abertos(1, 0, 0, 0)), 10);
    assert.equal(notaDeRisco(abertos(1, 2, 3, 4)), 10 + 14 + 12 + 4);
    assert.equal(notaDeRisco(abertos(10, 0, 0, 0)), NOTA_RISCO_MAXIMA);
    assert.equal(notaDeRisco(abertos(12, 5, 0, 0)), 100);
    assert.equal(pontosDeRisco(abertos(12, 5, 0, 0)), 155, 'os pontos sem teto desempatam o ranking');
  });

  it('riscoDe completa as quatro severidades e conta os abertos', () => {
    assert.deepEqual(riscoDe(), { notaRisco: 0, achadosAbertos: 0, abertosPorSeveridade: abertos(0, 0, 0, 0) });
    assert.deepEqual(riscoDe({ 'Alto': 2 }), { notaRisco: 14, achadosAbertos: 2, abertosPorSeveridade: abertos(0, 2, 0, 0) });
  });

  it('ranking: nota, pontos, críticos..., nome e id', () => {
    const ativo = (id: string, nome: string, a: Record<string, number>) => ({ id, nome, host: id, ...riscoDe(a) });
    const lista = [
      ativo('z', 'Zeta', abertos(0, 0, 1, 0)), // 4
      ativo('e', 'Eta', abertos(0, 0, 1, 0)), // 4: empata com Zeta, vem antes pelo nome
      ativo('d', 'Delta', abertos(1, 0, 0, 0)), // 10, um critico
      ativo('p', 'Epsilon', abertos(0, 1, 0, 3)), // 10, nenhum critico
      ativo('t', 'Teta', abertos(12, 0, 0, 0)), // 100 (120 pontos)
      ativo('i', 'Iota', abertos(11, 0, 0, 0)), // 100 (110 pontos)
      ativo('e2', 'Eta', abertos(0, 0, 1, 0)), // mesmo nome: desempata pelo id
    ];
    assert.deepEqual([...lista].sort(compararRisco).map((a) => a.id), ['t', 'i', 'd', 'p', 'e', 'e2', 'z']);
  });
});

describe('histórico de status (regra do completo)', () => {
  it('completo só quando a cadeia sai de "Aberta" e chega no status atual sem buraco', () => {
    assert.equal(historicoCompleto([], 'Aberta'), true);
    assert.equal(historicoCompleto([], 'Resolvida'), false, 'status mudou sem registro');
    assert.equal(historicoCompleto([{ de: 'Aberta', para: 'Em revisão' }, { de: 'Em revisão', para: 'Resolvida' }], 'Resolvida'), true);
    assert.equal(historicoCompleto([{ de: 'Em revisão', para: 'Resolvida' }], 'Resolvida'), false, 'falta a primeira mudança');
    assert.equal(historicoCompleto([{ de: 'Aberta', para: 'Em revisão' }], 'Resolvida'), false, 'falta a última');
  });
});

describe('regras da consulta paginada', () => {
  const codigo = (query: Record<string, unknown>) => {
    try {
      validar(query, CONSULTA_LISTA);
      return null;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
  };

  it('aceita ausente, vazio e valores válidos', () => {
    assert.equal(codigo({}), null);
    assert.equal(codigo({ pagina: '', tamanho: '', ordenar: '', direcao: '' }), null);
    assert.equal(codigo({ pagina: '3', tamanho: '100', ordenar: 'descricao', direcao: 'asc', severidade: 'alto', status: 'aberta' }), null);
  });

  it('recusa com o código do primeiro parâmetro inválido, na ordem das regras', () => {
    assert.equal(codigo({ severidade: 'x', pagina: '0' }), 'SEVERIDADE_INVALIDA');
    assert.equal(codigo({ pagina: '0' }), 'PAGINA_INVALIDA');
    assert.equal(codigo({ pagina: ['1'] }), 'PAGINA_INVALIDA');
    assert.equal(codigo({ tamanho: '101' }), 'TAMANHO_INVALIDO');
    assert.equal(codigo({ ordenar: 'severidade' }), 'ORDENACAO_INVALIDA');
    assert.equal(codigo({ direcao: 'para-cima' }), 'DIRECAO_INVALIDA');
  });

  it('tamanho no limite: 100 passa, 101 não', () => {
    assert.equal(codigo({ tamanho: '100' }), null);
    assert.equal(codigo({ tamanho: '101' }), 'TAMANHO_INVALIDO');
    assert.equal(codigo({ pagina: '1.5' }), 'PAGINA_INVALIDA');
  });
});
