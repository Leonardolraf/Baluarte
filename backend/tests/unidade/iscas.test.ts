// Iscas variadas da campanha (Melhorias #19/#26): invariantes de TODA isca de TODO template e
// estabilidade do sorteio por destinatário. Sem banco; só a estrutura e a função de seleção.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ISCAS, TEMPLATE_PADRAO_ISCA } from '../../src/services/iscas.data.js';
import { selecionarIsca } from '../../src/services/campanhaEmail.service.js';

const LINK = 'https://baluarte.example/t/TOKEN123';
const NOME = 'Fulano de Tal';

describe('iscas de campanha (#19/#26)', () => {
  it('há pelo menos um template e o padrão existe', () => {
    assert.ok(Object.keys(ISCAS).length >= 1);
    assert.ok(Array.isArray(ISCAS[TEMPLATE_PADRAO_ISCA]) && ISCAS[TEMPLATE_PADRAO_ISCA].length >= 1);
  });

  it('toda isca respeita as invariantes (texto, sem senha, só o link interno, sem rodapé)', () => {
    for (const [template, iscas] of Object.entries(ISCAS)) {
      assert.ok(iscas.length >= 1, `template ${template} sem iscas`);
      for (const isca of iscas) {
        assert.ok(isca.assunto.trim().length > 0, `assunto vazio em ${template}`);
        const corpo = isca.corpo(NOME, LINK);
        // interpola o nome e o link recebidos
        assert.ok(corpo.includes(NOME), `isca de ${template} não usa o nome`);
        assert.ok(corpo.includes(LINK), `isca de ${template} não usa o link`);
        // só texto: nada de HTML
        assert.doesNotMatch(corpo, /<[a-z/!]/i, `isca de ${template} tem marca de HTML`);
        // nenhum PEDIDO de credencial no corpo: a isca pode citar "senha" como tema (ex.: "sua
        // senha expira"), mas nunca instrui a digitar/informar/responder um segredo — o corpo só
        // leva ao link da plataforma, nunca coleta. (O serviço não tem formulário nem HTML.)
        assert.doesNotMatch(
          corpo,
          /(digite|informe|insira|forne[çc]a|envie|responda com|preencha|confirme)\s+(a |o |sua |seu |seus |suas )?(senha|credenci|\bpin\b|cart[ãa]o de cr[ée]dito|n[úu]mero do cart[ãa]o|cpf|c[óo]digo de (acesso|verifica))/i,
          `isca de ${template} pede credencial no corpo`,
        );
        // o único link é o do treinamento; nenhuma outra URL
        const urls = corpo.match(/https?:\/\/\S+/g) ?? [];
        assert.deepEqual(urls, [LINK], `isca de ${template} tem URL fora do link do treinamento`);
        // a isca não traz o rodapé de simulação nem o link de reporte (isso é do serviço)
        assert.doesNotMatch(corpo, /SIMULAÇÃO DE PHISHING|Reporte aqui/i, `isca de ${template} embute o rodapé`);
      }
    }
  });

  it('o sorteio é estável por destinatário: o mesmo token sempre dá a mesma isca', () => {
    for (const template of Object.keys(ISCAS)) {
      for (const token of ['tok-a', 'tok-b', 'tok-c', 'x'.repeat(40)]) {
        const primeira = selecionarIsca(template, token);
        for (let i = 0; i < 20; i++) assert.equal(selecionarIsca(template, token), primeira);
      }
    }
  });

  it('template desconhecido cai no padrão', () => {
    const esperada = selecionarIsca(TEMPLATE_PADRAO_ISCA, 'tok-z');
    assert.equal(selecionarIsca('inexistente', 'tok-z'), esperada);
  });

  it('a seleção fica dentro do array do template', () => {
    for (const [template, iscas] of Object.entries(ISCAS)) {
      for (const token of ['1', '2', '3', 'abc', 'zzz', 'token-longo-qualquer']) {
        assert.ok(iscas.includes(selecionarIsca(template, token)));
      }
    }
  });

  it('tokens diferentes alcançam mais de uma isca quando o template tem várias', () => {
    for (const [template, iscas] of Object.entries(ISCAS)) {
      if (iscas.length < 2) continue;
      const vistos = new Set<string>();
      for (let i = 0; i < 200; i++) vistos.add(selecionarIsca(template, `tok-${i}`).assunto);
      assert.ok(vistos.size >= 2, `o sorteio de ${template} nunca sai da primeira isca`);
    }
  });
});
