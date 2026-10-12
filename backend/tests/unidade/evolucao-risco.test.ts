// B25b, sem banco: pesos unicos de severidade, indice de risco tecnico global (agora no backend)
// e a montagem da evolucao do risco em 30 dias (dias no fuso de Brasilia, pontos e indice).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PESO_SEVERIDADE } from '../../src/models/dominio.model.js';
import { DIAS_EVOLUCAO, PONTOS_POR_ATIVO } from '../../src/models/dashboard.model.js';
import { indiceRiscoTecnico, pontosDeRisco } from '../../src/services/indiceRisco.service.js';
import { pontosDeRisco as pontosDoAtivo } from '../../src/services/riscoAtivo.service.js';
import { dataNoFuso, diasDaJanela, inicioDoDia, montarEvolucao } from '../../src/services/evolucaoRisco.service.js';

const contagem = (c: number, a: number, m: number, b: number) => ({ 'Crítico': c, 'Alto': a, 'Médio': m, 'Baixo': b });

/**
 * A regua linear (a do frontend ate o B25b e a do backend ate 12/10/2026) (adapters.ts#toDashboard), com os pesos como
 * parametro: round(ponderado / (max(1, ativos) x 20) x 100), entre 0 e 100.
 */
function indiceAntigo(pesos: [number, number, number, number], c: number, a: number, m: number, b: number, ativos: number) {
  const ponderado = c * pesos[0] + a * pesos[1] + m * pesos[2] + b * pesos[3];
  const capacidade = Math.max(1, ativos) * 20;
  return Math.max(0, Math.min(100, Math.round((ponderado / capacidade) * 100)));
}

describe('pesos únicos e índice global', () => {
  it('a nota do ativo e o índice usam a mesma soma ponderada (PESO_SEVERIDADE)', () => {
    assert.equal(pontosDoAtivo, pontosDeRisco);
    assert.equal(pontosDeRisco(contagem(1, 2, 3, 4)), PESO_SEVERIDADE['Crítico'] + 2 * PESO_SEVERIDADE['Alto'] + 3 * PESO_SEVERIDADE['Médio'] + 4);
    assert.equal(PONTOS_POR_ATIVO, 20);
  });

  it('curva de saturação (12/10/2026): os números da decisão do Leo, com os pesos 10/7/4/1', () => {
    // [críticos, altos, médios, baixos, ativos, índice]: a tabela que embasou a troca.
    const casos: [number, number, number, number, number, number][] = [
      [195, 490, 750, 80, 7, 100], // 11/10, antes do B36: 1.515 abertos
      [3, 14, 12, 3, 7, 72], // 12/10, depois do B36: 32 abertos (a régua linear dava 100)
      [2, 2, 3, 0, 7, 28], // só os achados simulados (a régua linear dava 33)
      [1, 0, 0, 0, 7, 7], // pouca carga: igual à régua linear
      [14, 0, 0, 0, 7, 63], // dois críticos por ativo: alto, não mais o teto
      [35, 0, 0, 0, 7, 92], // cinco críticos por ativo
    ];
    for (const [c, a, m, b, ativos, esperado] of casos)
      assert.equal(indiceRiscoTecnico(contagem(c, a, m, b), ativos), esperado, `${c}/${a}/${m}/${b} em ${ativos} ativos`);
  });

  it('com pouca carga é a régua linear antiga; com muita, fica abaixo dela e nunca trava antes de corrigir tudo', () => {
    assert.equal(indiceRiscoTecnico(contagem(1, 0, 0, 0), 7), indiceAntigo([10, 7, 4, 1], 1, 0, 0, 0, 7));
    for (const [c, a, m, b] of [[1, 2, 3, 4], [3, 14, 12, 3], [14, 0, 0, 0]])
      assert.ok(indiceRiscoTecnico(contagem(c, a, m, b), 7) <= indiceAntigo([10, 7, 4, 1], c, a, m, b, 7));
    // Cada achado corrigido baixa (ou mantém) o número: nada de patamar em 100 com 32 abertos.
    let anterior = indiceRiscoTecnico(contagem(3, 14, 12, 3), 7);
    for (let altos = 13; altos >= 0; altos--) {
      const atual = indiceRiscoTecnico(contagem(3, altos, 12, 3), 7);
      assert.ok(atual <= anterior, `${altos} altos`);
      anterior = atual;
    }
    assert.ok(anterior < 72);
  });

  it('a troca de pesos do DT07 continua valendo (exemplo do CHANGELOG, agora pela curva)', () => {
    // 1 crítico, 2 altos, 3 médios, 4 baixos em 3 ativos: 35/60 com 10/6/3/1, 40/60 com 10/7/4/1.
    assert.equal(indiceAntigo([10, 6, 3, 1], 1, 2, 3, 4, 3), 58);
    assert.equal(indiceRiscoTecnico(contagem(1, 2, 3, 4), 3), 49, '100 × (1 − e^(−40/60))');
  });

  it('piso 0, teto 100 e pelo menos 1 ativo na capacidade', () => {
    assert.equal(indiceRiscoTecnico(contagem(30, 0, 0, 0), 1), 100);
    assert.equal(indiceRiscoTecnico({}, 5), 0);
    assert.equal(indiceRiscoTecnico(contagem(1, 0, 0, 0), 0), 39, 'sem ativo, a capacidade é a de 1 ativo: 100 × (1 − e^(−10/20))');
  });
});

describe('dias da janela (fuso de Brasília)', () => {
  it('30 dias, do mais antigo a hoje; hoje termina agora, os outros 1 ms antes da meia-noite local', () => {
    const agora = new Date('2026-10-08T15:00:00.000Z'); // 12h em Brasília
    const dias = diasDaJanela(agora);
    assert.equal(dias.length, DIAS_EVOLUCAO);
    assert.equal(dias[0].data, '2026-09-09');
    assert.equal(dias[29].data, '2026-10-08');
    assert.equal(dias[29].fim, agora);
    assert.equal(dias[28].data, '2026-10-07');
    assert.equal(dias[28].fim.toISOString(), '2026-10-08T02:59:59.999Z');
    assert.equal(dias[0].fim.toISOString(), '2026-09-10T02:59:59.999Z');
  });

  it('23h30 em Brasília já é o dia seguinte em UTC, mas o dia é o local', () => {
    const agora = new Date('2026-10-08T02:30:00.000Z'); // 07/10, 23h30 em Brasília
    const dias = diasDaJanela(agora);
    assert.equal(dias[29].data, '2026-10-07');
    assert.equal(dataNoFuso(agora), '2026-10-07');
    assert.equal(dias[28].data, '2026-10-06');
  });

  it('virada de mês e de ano', () => {
    const dias = diasDaJanela(new Date('2027-01-02T12:00:00.000Z'), 5);
    assert.deepEqual(dias.map((d) => d.data), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('meia-noite local em outro fuso com horário de verão', () => {
    assert.equal(inicioDoDia(2026, 10, 8).toISOString(), '2026-10-08T03:00:00.000Z');
    // Nova York: 08/03/2026 começa em EST (-5) e o horário de verão entra às 2h.
    assert.equal(inicioDoDia(2026, 3, 8, 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z');
    assert.equal(inicioDoDia(2026, 3, 9, 'America/New_York').toISOString(), '2026-03-09T04:00:00.000Z');
  });
});

describe('montagem dos pontos', () => {
  const dias = diasDaJanela(new Date('2026-10-08T15:00:00.000Z'), 3);

  it('dia sem linha fica zerado; contagens por severidade; índice com a fórmula do KPI', () => {
    const pontos = montarEvolucao(
      dias,
      [
        { dia: 2, severidade: 'Crítico', total: 1 },
        { dia: 2, severidade: 'Baixo', total: 4 },
        { dia: 3, severidade: 'Alto', total: 2 },
        { dia: 3, severidade: 'Médio', total: 3 },
      ],
      [0, 0, 0],
      [2, 2, 3],
    );
    assert.deepEqual(pontos[0], { data: '2026-10-06', critico: 0, alto: 0, medio: 0, baixo: 0, arquivosMaliciosos: 0, ativos: 2, indice: 0 });
    assert.deepEqual(pontos[1], { data: '2026-10-07', critico: 1, alto: 0, medio: 0, baixo: 4, arquivosMaliciosos: 0, ativos: 2, indice: 30 }); // 14/40 pela curva
    assert.equal(pontos[2].indice, indiceRiscoTecnico(contagem(0, 2, 3, 0), 3));
  });

  it('arquivo malicioso pesa como crítico no índice, mas não entra na contagem de críticos', () => {
    const [ponto] = montarEvolucao(dias.slice(0, 1), [], [2], [1]);
    assert.equal(ponto.critico, 0);
    assert.equal(ponto.arquivosMaliciosos, 2);
    assert.equal(ponto.indice, 63, 'dois arquivos = dois críticos em 1 ativo: 100 × (1 − e^(−1))');
  });
});
