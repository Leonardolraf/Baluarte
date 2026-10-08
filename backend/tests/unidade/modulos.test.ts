// Testes de UNIDADE das pecas criadas na separacao em modulos (B01), sem banco: erro de
// negocio convertido no envelope do contrato, metricas de campanha, conteudo e permissao
// do treinamento, e as constantes de dominio.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { ErroNegocio, falhar, wrap } from '../../src/http/resposta.js';
import { funilDe, mapCampaign, totais } from '../../src/modules/campaigns/metricas.js';
import { dadosTreinamento, podeVerTreinamento } from '../../src/modules/training/conteudo.js';
import { OPERADORES, PERFIS, STATUS_FINDING, STATUS_FINDING_ENCERRADO } from '../../src/shared/dominio.js';

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

describe('erro de negócio (http/resposta)', () => {
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
});
