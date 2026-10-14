// TRUST_PROXY (config/trustProxy.ts): so o numero de saltos, inteiro de 0 a 5. Qualquer outro
// valor ("true" de proposito: deixaria o cliente forjar o IP) impede a API de subir. Sem banco:
// a subida e o src/server.ts de verdade num processo filho, que falha antes de abrir a porta.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerTrustProxy, TrustProxyInvalido } from '../../src/config/trustProxy.js';

const RAIZ_BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('lerTrustProxy', () => {
  for (const [valor, saltos] of [[undefined, 0], ['', 0], ['0', 0], ['1', 1], ['2', 2], ['5', 5]] as const) {
    it(`aceita ${JSON.stringify(valor)} → ${saltos}`, () => {
      assert.equal(lerTrustProxy(valor), saltos);
    });
  }

  for (const valor of ['true', 'false', 'abc', '-1', '6', '10', '1.5', '01', ' 1', 'loopback', '10.0.0.1', '10.0.0.0/8, 127.0.0.1']) {
    it(`recusa ${JSON.stringify(valor)}`, () => {
      assert.throws(() => lerTrustProxy(valor), (e: unknown) => e instanceof TrustProxyInvalido && /TRUST_PROXY inválido/.test(e.message));
    });
  }

  it('a mensagem explica por que "true" é recusado', () => {
    assert.throws(() => lerTrustProxy('true'), /de 0 a 5[\s\S]*"true" deixaria o cliente forjar o IP/);
  });
});

/** Porta TCP livre no loopback (nunca a 8080 do .env). */
function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

/** Sobe src/server.ts com TRUST_PROXY=valor; termina quando o processo sai ou anuncia a porta. */
async function subirServidor(valor: string): Promise<{ codigo: number | null; subiu: boolean; saida: string }> {
  const porta = await portaLivre();
  const filho = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: RAIZ_BACKEND,
    env: { ...process.env, TRUST_PROXY: valor, PORT: String(porta), NODE_ENV: 'test', JWT_SECRET: 'segredo-somente-para-testes' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  return new Promise((ok, falha) => {
    const limite = setTimeout(() => {
      filho.kill();
      falha(new Error(`server.ts nem saiu nem subiu em 30 s:\n${saida}`));
    }, 30_000);
    const ler = (d: Buffer) => {
      saida += d.toString('utf8');
      if (saida.includes('API real ouvindo')) {
        clearTimeout(limite);
        filho.kill();
        ok({ codigo: null, subiu: true, saida });
      }
    };
    filho.stdout.on('data', ler);
    filho.stderr.on('data', ler);
    filho.on('exit', (codigo) => {
      clearTimeout(limite);
      ok({ codigo, subiu: false, saida });
    });
  });
}

describe('subida da API com TRUST_PROXY', () => {
  for (const valor of ['true', '6']) {
    it(`TRUST_PROXY=${valor}: a API não sobe e diz por quê`, async () => {
      const r = await subirServidor(valor);
      assert.equal(r.subiu, false, r.saida);
      assert.notEqual(r.codigo, 0, r.saida);
      assert.match(r.saida, /TRUST_PROXY inválido/);
    });
  }

  it('TRUST_PROXY=1: a API sobe (controle do teste acima)', async () => {
    const r = await subirServidor('1');
    assert.equal(r.subiu, true, r.saida);
  });
});
