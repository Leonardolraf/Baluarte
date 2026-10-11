// Testes de UNIDADE das pecas criadas na separacao em modulos (B01), sem banco: erro de
// negocio convertido no envelope do contrato, metricas de campanha, conteudo e permissao
// do treinamento, e as constantes de dominio.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { ErroNegocio, falhar, wrap } from '../../src/utils/resposta.js';
import { funilDe, mapCampaign, riscoHumano, totais } from '../../src/services/campanhaMetricas.service.js';
import { dadosTreinamento, podeVerTreinamento } from '../../src/models/treinamento.model.js';
import { OPERADORES, PERFIS, PESO_RISCO_HUMANO, STATUS_FINDING, STATUS_FINDING_ENCERRADO, destinatarioInterno, destinatariosInternos, dominioInterno } from '../../src/models/dominio.model.js';

function resposta(jaEnviada = false) {
  const r = {
    statusCode: 0,
    body: undefined as any,
    headersSent: jaEnviada,
    status(c: number) { r.statusCode = c; return r; },
    json(b: unknown) { r.body = b; r.headersSent = true; return r; },
  };
  return r;
}
const esperar = () => new Promise((ok) => setImmediate(ok));

describe('erro de negócio (utils/resposta)', () => {
  it('falhar lança ErroNegocio com status, mensagem e código', () => {
    assert.throws(() => falhar(409, 'Ativo já cadastrado', 'ATIVO_DUPLICADO'), (e: unknown) =>
      e instanceof ErroNegocio && e.status === 409 && e.mensagem === 'Ativo já cadastrado' && e.codigo === 'ATIVO_DUPLICADO');
  });

  it('wrap devolve o envelope do contrato para ErroNegocio, sem logar como erro interno', async () => {
    const r = resposta();
    const original = console.error;
    let logou = false;
    console.error = () => { logou = true; };
    try {
      wrap(async () => falhar(404, 'Usuário não encontrado', 'USUARIO_NAO_ENCONTRADO'))({} as Request, r as unknown as Response);
      await esperar();
    } finally {
      console.error = original;
    }
    assert.equal(r.statusCode, 404);
    assert.deepEqual({ status: r.body.status, mensagem: r.body.mensagem, codigoErro: r.body.codigoErro },
      { status: 'erro', mensagem: 'Usuário não encontrado', codigoErro: 'USUARIO_NAO_ENCONTRADO' });
    assert.equal(logou, false);
  });

  it('wrap não responde de novo se a resposta já saiu', async () => {
    const r = resposta(true);
    wrap(async () => falhar(400, 'x', 'Y'))({} as Request, r as unknown as Response);
    await esperar();
    assert.equal(r.statusCode, 0);
  });
});

describe('métricas de campanha', () => {
  const d = new Date('2026-10-01T12:00:00Z');
  const ev = (o: Partial<Record<'enviadoEm' | 'abertoEm' | 'clicadoEm' | 'submeteuEm' | 'reportouEm', Date>>) =>
    ({ enviadoEm: null, abertoEm: null, clicadoEm: null, submeteuEm: null, reportouEm: null, ...o });

  it('funilDe: valores e percentuais sobre os enviados', () => {
    const f = funilDe([
      ev({ enviadoEm: d, abertoEm: d, clicadoEm: d }),
      ev({ enviadoEm: d, abertoEm: d, reportouEm: d }),
      ev({ enviadoEm: d }),
      ev({ enviadoEm: d, abertoEm: d, clicadoEm: d, submeteuEm: d }),
    ]);
    assert.deepEqual(f.enviados, { valor: 4, pct: 100 });
    assert.deepEqual(f.abertos, { valor: 3, pct: 75 });
    assert.deepEqual(f.clicados, { valor: 2, pct: 50 });
    assert.deepEqual(f.submeteram, { valor: 1, pct: 25 });
    assert.deepEqual(f.reportaram, { valor: 1, pct: 25 });
  });

  it('riscoHumano: pesos 2/2 sobre as taxas de clique e de submissão de todas as campanhas, com teto 100', () => {
    assert.deepEqual(PESO_RISCO_HUMANO, { clique: 2, submissao: 2 });
    // 4 enviados em duas campanhas: 2 cliques (50 %), 1 submissão (25 %) -> 50x2 + 25x2 = 150 -> 100.
    const c1 = { eventos: [ev({ enviadoEm: d, clicadoEm: d }), ev({ enviadoEm: d })] };
    const c2 = { eventos: [ev({ enviadoEm: d, clicadoEm: d, submeteuEm: d }), ev({ enviadoEm: d })] };
    assert.equal(riscoHumano([c1, c2]), 100);
    // 10 enviados, 1 clique (10 %), nenhuma submissão -> 20; quem não recebeu não entra na conta.
    const dez = { eventos: [ev({ enviadoEm: d, clicadoEm: d }), ...Array.from({ length: 9 }, () => ev({ enviadoEm: d })), ev({})] };
    assert.equal(riscoHumano([dez]), 20);
    // 3 enviados, 1 clique e 1 submissão: taxas arredondadas antes do peso (33 % e 33 %) -> 132 -> 100.
    assert.equal(riscoHumano([{ eventos: [ev({ enviadoEm: d, clicadoEm: d, submeteuEm: d }), ev({ enviadoEm: d }), ev({ enviadoEm: d })] }]), 100);
    assert.equal(riscoHumano([{ eventos: [ev({ enviadoEm: d }), ev({ enviadoEm: d })] }]), 0);
  });

  it('riscoHumano sem envio é null (não medido), nunca 0', () => {
    assert.equal(riscoHumano([]), null);
    assert.equal(riscoHumano([{ eventos: [ev({})] }]), null);
  });

  it('funilDe sem envios não divide por zero', () => {
    assert.deepEqual(funilDe([ev({})]).clicados, { valor: 0, pct: 0 });
  });

  it('mapCampaign: destinatários e taxa de clique arredondada', () => {
    const c = mapCampaign({
      id: 'c1', nome: 'Teste', template: 'urgencia', status: 'ATIVA', criadoEm: d,
      eventos: [ev({ enviadoEm: d, clicadoEm: d }), ev({ enviadoEm: d }), ev({ enviadoEm: d }), ev({})],
    });
    assert.equal(c.destinatarios, 4);
    assert.equal(c.taxaClique, 33);
  });

  it('totais soma enviados e clicados de todas as campanhas', () => {
    assert.deepEqual(totais([
      { eventos: [ev({ enviadoEm: d, clicadoEm: d }), ev({ enviadoEm: d })] },
      { eventos: [ev({ enviadoEm: d, clicadoEm: d })] },
    ]), { enviados: 3, clicados: 2 });
  });
});

describe('treinamento', () => {
  it('podeVerTreinamento: dono, Administrador e Analista sim; outro Colaborador não', () => {
    const evento = { userId: 'u1' };
    assert.ok(podeVerTreinamento({ id: 'u1', perfil: 'Colaborador' }, evento));
    assert.ok(podeVerTreinamento({ id: 'u9', perfil: 'Administrador' }, evento));
    assert.ok(podeVerTreinamento({ id: 'u9', perfil: 'Analista' }, evento));
    assert.equal(podeVerTreinamento({ id: 'u9', perfil: 'Colaborador' }, evento), false);
  });

  it('dadosTreinamento: conteúdo pelo template, progresso e template desconhecido cai em urgência', () => {
    const feito = dadosTreinamento({ treinou: true, treinouEm: new Date(), campaign: { template: 'autoridade' } });
    assert.equal(feito.tipoAtaque, 'Phishing por Autoridade');
    assert.equal(feito.progresso, 100);
    assert.ok(feito.sinaisAlerta.length > 0 && feito.boasPraticas.length > 0);
    const pendente = dadosTreinamento({ treinou: false, treinouEm: null, campaign: { template: 'inexistente' } });
    assert.equal(pendente.tipoAtaque, 'Phishing por Urgência');
    assert.equal(pendente.progresso, 0);
    assert.equal(pendente.template, 'inexistente');
  });
});

describe('constantes de domínio', () => {
  it('operadores são Administrador e Analista; status encerrados são subconjunto dos status de achado', () => {
    assert.deepEqual(OPERADORES, ['Administrador', 'Analista']);
    for (const p of OPERADORES) assert.ok(PERFIS.includes(p));
    for (const s of STATUS_FINDING_ENCERRADO) assert.ok(STATUS_FINDING.includes(s));
  });

  it('dominioInterno: DOMINIO_INTERNO do ambiente, normalizado, com @empresa.com por padrão (B10)', () => {
    const original = process.env.DOMINIO_INTERNO;
    try {
      delete process.env.DOMINIO_INTERNO;
      assert.equal(dominioInterno(), '@empresa.com');
      process.env.DOMINIO_INTERNO = '   ';
      assert.equal(dominioInterno(), '@empresa.com');
      process.env.DOMINIO_INTERNO = ' Filial.Exemplo.com.br ';
      assert.equal(dominioInterno(), '@filial.exemplo.com.br');
      process.env.DOMINIO_INTERNO = '@outra.com';
      assert.equal(dominioInterno(), '@outra.com');
    } finally {
      if (original === undefined) delete process.env.DOMINIO_INTERNO;
      else process.env.DOMINIO_INTERNO = original;
    }
  });

  it('destinatarioInterno (DT19): lista de domínios e endereços liberados, sem liberar o provedor inteiro', () => {
    const original = process.env.DOMINIO_INTERNO;
    try {
      process.env.DOMINIO_INTERNO = '@baluarte.test, Pessoa@Gmail.com;filial.exemplo';
      assert.deepEqual(destinatariosInternos(), { dominios: ['@baluarte.test', '@filial.exemplo'], enderecos: ['pessoa@gmail.com'] });
      assert.equal(dominioInterno(), '@baluarte.test', 'o primeiro domínio da lista');
      assert.equal(destinatarioInterno('ana@baluarte.test'), true);
      assert.equal(destinatarioInterno(' PESSOA@gmail.com '), true, 'endereço liberado, sem diferença de maiúsculas');
      assert.equal(destinatarioInterno('outra@gmail.com'), false, 'o resto do provedor continua externo');
      assert.equal(destinatarioInterno('x@sub.filial.exemplo'), false, 'subdomínio não é o domínio');
      assert.equal(destinatarioInterno('ana@empresa.com'), false);
      process.env.DOMINIO_INTERNO = 'so@endereco.com';
      assert.deepEqual(destinatariosInternos(), { dominios: [], enderecos: ['so@endereco.com'] });
      assert.equal(dominioInterno(), '@empresa.com', 'sem domínio na lista, o rótulo cai no padrão');
      assert.equal(destinatarioInterno('ana@empresa.com'), false, 'mas o padrão não é aceito se a lista só tem endereços');
      delete process.env.DOMINIO_INTERNO;
      assert.equal(destinatarioInterno('ana@empresa.com'), true);
    } finally {
      if (original === undefined) delete process.env.DOMINIO_INTERNO;
      else process.env.DOMINIO_INTERNO = original;
    }
  });
});
