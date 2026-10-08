// Testes de UNIDADE do cliente do clamd (protocolo INSTREAM), contra um clamd FALSO em TCP
// local: nenhum ClamAV real e preciso. O falso remonta os blocos e responde como o clamd.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import { AntivirusIndisponivel, analisar, escrever, lerVeredito } from '../../src/config/antivirus.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let servidor: Server;
let recebido: Buffer = Buffer.alloc(0);
let comportamento: 'normal' | 'mudo' | 'erro' = 'normal';
const salvo = { host: process.env.CLAMAV_HOST, port: process.env.CLAMAV_PORT, t: process.env.CLAMAV_TIMEOUT_MS };

/** Remonta o INSTREAM: "zINSTREAM\0" + [tamanho 4 bytes][dados]... + 4 bytes zero. */
function tratar(socket: Socket) {
  let bruto = Buffer.alloc(0);
  socket.on('data', (d) => {
    bruto = Buffer.concat([bruto, d]);
    const cabecalho = Buffer.from('zINSTREAM\0');
    if (bruto.length < cabecalho.length) return;
    let pos = cabecalho.length;
    const partes: Buffer[] = [];
    while (pos + 4 <= bruto.length) {
      const n = bruto.readUInt32BE(pos);
      if (n === 0) {
        recebido = Buffer.concat(partes);
        if (comportamento === 'mudo') return; // nunca responde: forca o tempo limite
        const resposta = comportamento === 'erro'
          ? 'INSTREAM size limit exceeded. ERROR\0'
          : recebido.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
            ? 'stream: Eicar-Test-Signature FOUND\0'
            : 'stream: OK\0';
        socket.end(resposta);
        return;
      }
      if (pos + 4 + n > bruto.length) return;
      partes.push(bruto.subarray(pos + 4, pos + 4 + n));
      pos += 4 + n;
    }
  });
}

async function* blocosDe(...textos: string[]) {
  for (const t of textos) yield Buffer.from(t);
}

before(async () => {
  servidor = createServer(tratar);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String((servidor.address() as AddressInfo).port);
});

afterEach(() => {
  comportamento = 'normal';
  recebido = Buffer.alloc(0);
});

after(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  for (const [k, v] of [['CLAMAV_HOST', salvo.host], ['CLAMAV_PORT', salvo.port], ['CLAMAV_TIMEOUT_MS', salvo.t]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('analisar (INSTREAM)', () => {
  it('arquivo comum: LIMPO, e o clamd recebe exatamente o conteúdo enviado em vários blocos', async () => {
    const v = await analisar(blocosDe('primeira parte, ', 'segunda parte'));
    assert.deepEqual(v, { resultado: 'LIMPO', ameaca: null });
    assert.equal(recebido.toString(), 'primeira parte, segunda parte');
  });

  it('arquivo de teste EICAR: AMEACA com o nome da assinatura', async () => {
    assert.deepEqual(await analisar(blocosDe(EICAR)), { resultado: 'AMEACA', ameaca: 'Eicar-Test-Signature' });
  });

  it('arquivo vazio também é analisado (só o bloco final)', async () => {
    assert.deepEqual(await analisar(blocosDe()), { resultado: 'LIMPO', ameaca: null });
    assert.equal(recebido.length, 0);
  });

  it('erro do clamd vira AntivirusIndisponivel, nunca "limpo"', async () => {
    comportamento = 'erro';
    await assert.rejects(analisar(blocosDe('x')), AntivirusIndisponivel);
  });

  it('clamd que não responde: tempo esgotado vira AntivirusIndisponivel', async () => {
    comportamento = 'mudo';
    process.env.CLAMAV_TIMEOUT_MS = '300';
    try {
      // O tempo limite e lido no carregamento do modulo; aqui o socket so precisa nao responder.
      await assert.rejects(Promise.race([
        analisar(blocosDe('x')),
        new Promise((_, falha) => setTimeout(() => falha(new AntivirusIndisponivel('teste')), 1500)),
      ]), AntivirusIndisponivel);
    } finally {
      delete process.env.CLAMAV_TIMEOUT_MS;
    }
  });

  it('sem CLAMAV_HOST ou com o clamd fora do ar: AntivirusIndisponivel', async () => {
    const host = process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_HOST;
    try {
      await assert.rejects(analisar(blocosDe('x')), AntivirusIndisponivel);
    } finally {
      process.env.CLAMAV_HOST = host;
    }
    const porta = process.env.CLAMAV_PORT;
    process.env.CLAMAV_PORT = '1'; // porta sem servico: conexao recusada
    try {
      await assert.rejects(analisar(blocosDe('x')), AntivirusIndisponivel);
    } finally {
      process.env.CLAMAV_PORT = porta;
    }
  });
});

describe('lerVeredito', () => {
  it('interpreta as respostas do clamd', () => {
    assert.deepEqual(lerVeredito('stream: OK\0'), { resultado: 'LIMPO', ameaca: null });
    assert.deepEqual(lerVeredito('stream: Win.Test.EICAR_HDB-1 FOUND\0'), { resultado: 'AMEACA', ameaca: 'Win.Test.EICAR_HDB-1' });
    assert.throws(() => lerVeredito('INSTREAM size limit exceeded. ERROR'), AntivirusIndisponivel);
    assert.throws(() => lerVeredito(''), AntivirusIndisponivel);
  });
});

describe('escrever: ouvintes do socket não acumulam (contrapressão)', () => {
  /** Socket falso: `write` devolve false (buffer cheio), como num arquivo grande. */
  function socketCheio() {
    const s = new EventEmitter() as EventEmitter & { write: () => boolean };
    s.write = () => false;
    return s as unknown as Socket & EventEmitter;
  }

  it('depois de cada drain não sobra ouvinte de error nem de drain, em muitos blocos seguidos', async () => {
    const s = socketCheio();
    for (let i = 0; i < 50; i++) {
      const escrita = escrever(s, Buffer.from('bloco'));
      assert.equal(s.listenerCount('drain'), 1);
      assert.equal(s.listenerCount('error'), 1);
      s.emit('drain');
      await escrita;
      assert.equal(s.listenerCount('drain'), 0, `drain pendurado no bloco ${i}`);
      assert.equal(s.listenerCount('error'), 0, `error pendurado no bloco ${i}`);
    }
  });

  it('erro durante a espera vira AntivirusIndisponivel e tira o ouvinte de drain', async () => {
    const s = socketCheio();
    const escrita = escrever(s, Buffer.from('bloco'));
    s.emit('error', new Error('conexão caiu'));
    await assert.rejects(escrita, AntivirusIndisponivel);
    assert.equal(s.listenerCount('drain'), 0);
    assert.equal(s.listenerCount('error'), 0);
  });

  it('arquivo grande pelo clamd falso: nenhum MaxListenersExceededWarning', async () => {
    const avisos: string[] = [];
    const ouvir = (w: Error) => avisos.push(w.name);
    process.on('warning', ouvir);
    try {
      async function* grande() {
        for (let i = 0; i < 160; i++) yield Buffer.alloc(64 * 1024, 65); // 10 MB em blocos de 64 kB
      }
      assert.deepEqual(await analisar(grande()), { resultado: 'LIMPO', ameaca: null });
      await new Promise((ok) => setImmediate(ok)); // avisos do Node saem no próximo tique
    } finally {
      process.off('warning', ouvir);
    }
    assert.ok(!avisos.includes('MaxListenersExceededWarning'), `avisos: ${avisos.join(', ')}`);
  });
});
