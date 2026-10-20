// Allowlist (decisao do Leo em 21/10/2026): com CAMPANHA_SEM_TRAVA_DOMINIO=1 a campanha aceita
// QUALQUER usuario cadastrado e Ativo, de qualquer dominio. DEFAULT OFF: trava de dominio vale
// (contrato N2 AT1 intacto). Este arquivo prova os DOIS estados pela rota POST /campaigns; o
// toggle unitario de destinatarioInterno fica em tests/unidade/allowlist-dominio.test.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, SENHA_CONTA, tokenDoEmail } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let admin = '';
let analista = '';
let gmail = '';

/** Cria um usuario Ativo com um e-mail de dominio EXTERNO (gmail), pela API. */
async function criarUsuarioExterno(email: string): Promise<void> {
  const r = await chamar('POST', '/users', { token: admin, body: { nome: 'Externo', email, perfil: 'Colaborador' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const convite = await tokenDoEmail(email, 'definir-senha');
  assert.ok(convite, `esperava convite para ${email}`);
  const c = await chamar('POST', '/auth/reset-password/confirm', { body: { token: convite, novaSenha: SENHA_CONTA } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
}

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  gmail = `externo.${Date.now()}@gmail.com`;
  await criarUsuarioExterno(gmail);
});

after(async () => {
  delete process.env.CAMPANHA_SEM_TRAVA_DOMINIO;
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('allowlist da campanha (CAMPANHA_SEM_TRAVA_DOMINIO)', () => {
  it('OFF (padrão): destinatário de domínio externo é recusado com 422 DESTINATARIO_EXTERNO', async () => {
    delete process.env.CAMPANHA_SEM_TRAVA_DOMINIO;
    const r = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Externo off', destinatario: gmail, template: 'urgencia' } });
    esperaErro(r, 422, 'DESTINATARIO_EXTERNO');
  });

  it('ON: o mesmo usuário gmail cadastrado e Ativo é aceito (201)', async () => {
    process.env.CAMPANHA_SEM_TRAVA_DOMINIO = '1';
    try {
      const r = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Externo on', destinatario: gmail, template: 'urgencia' } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.dados.emailsEnviados, 1);
    } finally {
      delete process.env.CAMPANHA_SEM_TRAVA_DOMINIO;
    }
  });

  it('ON: o gate "Ativo cadastrado" continua — e-mail NÃO cadastrado segue recusado', async () => {
    process.env.CAMPANHA_SEM_TRAVA_DOMINIO = '1';
    try {
      const r = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Fantasma', destinatario: `ninguem.${Date.now()}@gmail.com`, template: 'urgencia' } });
      // domínio liberado, mas não é usuário cadastrado: recusa de cadastro, não de domínio
      esperaErro(r, 422, 'DESTINATARIO_NAO_CADASTRADO');
    } finally {
      delete process.env.CAMPANHA_SEM_TRAVA_DOMINIO;
    }
  });
});
