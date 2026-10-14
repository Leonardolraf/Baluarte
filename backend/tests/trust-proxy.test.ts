// TRUST_PROXY=1 (um proxy na frente da API, como o Tailscale Funnel): o IP gravado na abertura
// do link do e-mail da campanha (Melhorias #6) e o ULTIMO salto do X-Forwarded-For, o endereco
// que o proxy viu; o que o cliente escreve a esquerda e ignorado. O caso sem a variavel (X-Forwarded-For
// forjado nao muda nada) esta em aberturas-link.test.ts. Banco isolado (helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, chamar, criarUsuario, encerrarServidor, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);
// Depois do prepararBanco (que apaga a variavel) e antes de importar a app, que le na carga.
process.env.TRUST_PROXY = '1';

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { hashToken } = await import('../src/utils/tokens.js');

const UA = 'Mozilla/5.0 (Teste TrustProxy) Baluarte/1.0';
let pessoa: { id: string; email: string };
let seq = 0;

before(async () => {
  await iniciarServidor(app);
  pessoa = await criarUsuario(await login(ADMIN.email, ADMIN.senha), 'Colaborador', 'trust.proxy');
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Abre o link de uma campanha nova e devolve o IP gravado na abertura. */
async function ipDaAbertura(headers: Record<string, string>): Promise<string | null> {
  seq += 1;
  const token = `tp${String(seq).padStart(4, '0')}`.padEnd(64, 'b');
  const c = await prisma.campaign.create({
    data: {
      nome: `TrustProxy ${seq}`,
      template: 'urgencia',
      eventos: { create: [{ userId: pessoa.id, destinatario: pessoa.email, tokenHash: hashToken(token), enviadoEm: new Date() }] },
    },
    include: { eventos: true },
  });
  const r = await chamar('GET', `/treinamentos/link/${token}`, { headers: { 'User-Agent': UA, ...headers } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const linhas = await prisma.campaignLinkHit.findMany({ where: { campaignEventId: c.eventos[0].id } });
  assert.equal(linhas.length, 1);
  return linhas[0].ip;
}

describe('TRUST_PROXY=1', () => {
  it('o app confia em exatamente um salto', () => {
    assert.equal(app.get('trust proxy'), 1);
  });

  it('o IP gravado é o último salto do X-Forwarded-For, não o que o cliente escreveu à esquerda', async () => {
    assert.equal(await ipDaAbertura({ 'X-Forwarded-For': '203.0.113.7, 198.51.100.9' }), '198.51.100.9');
  });

  it('com um endereço só no X-Forwarded-For, é ele', async () => {
    assert.equal(await ipDaAbertura({ 'X-Forwarded-For': '198.51.100.20' }), '198.51.100.20');
  });

  it('sem X-Forwarded-For, continua o endereço do socket', async () => {
    assert.match((await ipDaAbertura({})) ?? '', /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/);
  });
});
