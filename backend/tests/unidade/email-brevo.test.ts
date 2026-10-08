// Testes de UNIDADE do transporte Brevo (API HTTPS de e-mail). Um servidor HTTP local faz
// o papel da API do Brevo: nenhum e-mail de verdade sai daqui.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { enviarEmail, lerRemetente } from '../../src/platform/email.js';

type Recebido = { headers: IncomingMessage['headers']; corpo: any };
let servidor: Server;
let recebidos: Recebido[] = [];
let statusResposta = 201;
const salvo = { ...process.env };

before(async () => {
  servidor = createServer((req, res) => {
    let bruto = '';
    req.on('data', (c) => { bruto += c; });
    req.on('end', () => {
      recebidos.push({ headers: req.headers, corpo: JSON.parse(bruto) });
      res.writeHead(statusResposta, { 'content-type': 'application/json' });
      res.end(statusResposta < 300 ? '{"messageId":"<x@brevo>"}' : '{"code":"unauthorized","message":"Key not found"}');
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  process.env.NODE_ENV = 'development';
  process.env.BREVO_API_KEY = 'xkeysib-chave-de-teste';
  process.env.BREVO_API_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v3/smtp/email`;
  process.env.EMAIL_REMETENTE = 'Baluarte <remetente@empresa.com>';
  delete process.env.SMTP_HOST;
});

afterEach(() => {
  recebidos = [];
  statusResposta = 201;
});

after(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  for (const k of ['NODE_ENV', 'BREVO_API_KEY', 'BREVO_API_URL', 'EMAIL_REMETENTE', 'SMTP_HOST']) {
    if (salvo[k] === undefined) delete process.env[k];
    else process.env[k] = salvo[k];
  }
});

describe('transporte Brevo', () => {
  it('envia pela API com a chave no cabeçalho, remetente separado em nome e e-mail, e só texto', async () => {
    assert.equal(await enviarEmail({ para: 'ana@empresa.com', assunto: 'Convite', texto: 'Olá' }), true);
    assert.equal(recebidos.length, 1);
    const [r] = recebidos;
    assert.equal(r.headers['api-key'], 'xkeysib-chave-de-teste');
    assert.deepEqual(r.corpo, {
      sender: { name: 'Baluarte', email: 'remetente@empresa.com' },
      to: [{ email: 'ana@empresa.com' }],
      subject: 'Convite',
      textContent: 'Olá',
    });
  });

  it('tem prioridade sobre o SMTP quando os dois estão configurados', async () => {
    process.env.SMTP_HOST = '127.0.0.1';
    try {
      assert.equal(await enviarEmail({ para: 'ana@empresa.com', assunto: 'A', texto: 'B' }), true);
      assert.equal(recebidos.length, 1);
    } finally {
      delete process.env.SMTP_HOST;
    }
  });

  it('erro da API vira false, e o log não leva a chave nem o conteúdo do e-mail', async () => {
    statusResposta = 401;
    const original = console.error;
    const logs: string[] = [];
    console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    try {
      assert.equal(await enviarEmail({ para: 'ana@empresa.com', assunto: 'Assunto', texto: 'link-secreto' }), false);
    } finally {
      console.error = original;
    }
    const tudo = logs.join('\n');
    assert.match(tudo, /401 unauthorized/);
    assert.doesNotMatch(tudo, /xkeysib|link-secreto/);
  });
});

describe('lerRemetente', () => {
  it('separa nome e e-mail nos formatos aceitos', () => {
    assert.deepEqual(lerRemetente('Baluarte <a@b.com>'), { name: 'Baluarte', email: 'a@b.com' });
    assert.deepEqual(lerRemetente('"Equipe Baluarte" <a@b.com>'), { name: 'Equipe Baluarte', email: 'a@b.com' });
    assert.deepEqual(lerRemetente('<a@b.com>'), { email: 'a@b.com' });
    assert.deepEqual(lerRemetente(' a@b.com '), { email: 'a@b.com' });
  });
});
