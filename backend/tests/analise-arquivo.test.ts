// Testes de integracao da analise de arquivos (B04): API real + Postgres isolado (helpers.ts)
// e um clamd FALSO em TCP local que fala o protocolo INSTREAM e reconhece o EICAR. O ClamAV
// de verdade (3 a 4 GiB de RAM) fica para o teste manual com `--profile antivirus`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { ADMIN, ANALISTA, SENHA_CONTA, criarUsuario, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, urlBase, chamar } from './helpers.js';

prepararBanco(import.meta.url);

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
let clamd: Server;
let recebidoPeloClamd = 0;

function falsoClamd(socket: Socket) {
  let bruto = Buffer.alloc(0);
  socket.on('data', (d) => {
    bruto = Buffer.concat([bruto, d]);
    let pos = 'zINSTREAM\0'.length;
    const partes: Buffer[] = [];
    while (pos + 4 <= bruto.length) {
      const n = bruto.readUInt32BE(pos);
      if (n === 0) {
        const conteudo = Buffer.concat(partes);
        recebidoPeloClamd = conteudo.length;
        socket.end(conteudo.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0');
        return;
      }
      if (pos + 4 + n > bruto.length) return;
      partes.push(bruto.subarray(pos + 4, pos + 4 + n));
      pos += 4 + n;
    }
  });
}

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let admin = '';
let analista = '';
let colab = '';
let colabId = '';

before(async () => {
  clamd = createServer(falsoClamd);
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', ok));
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String((clamd.address() as AddressInfo).port);
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  const c = await criarUsuario(admin, 'Colaborador', 'arquivo');
  colab = await login(c.email, SENHA_CONTA);
  colabId = c.id;
});

after(async () => {
  await encerrarServidor();
  await new Promise<void>((ok) => clamd.close(() => ok()));
  await prisma.$disconnect();
});

/** Envia multipart de verdade (fetch + FormData), como o navegador. */
async function enviarArquivo(token: string | null, conteudo: Buffer | string | null, nome = 'documento.pdf', campo = 'arquivo') {
  const form = new FormData();
  if (conteudo !== null) form.append(campo, new Blob([typeof conteudo === 'string' ? conteudo : new Uint8Array(conteudo)]), nome);
  const r = await fetch(`${urlBase()}/arquivos/analise`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return { status: r.status, body: await r.json() as any };
}

describe('POST /arquivos/analise', () => {
  it('arquivo comum: 201 "Nenhuma ameaça conhecida encontrada", com tamanho e SHA-256 corretos, e registro', async () => {
    const conteudo = Buffer.from('relatorio trimestral, nada de mais aqui');
    const r = await enviarArquivo(colab, conteudo, 'C:\\fakepath\\relatorio.txt');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.mensagem, 'Nenhuma ameaça conhecida encontrada');
    assert.equal(r.body.dados.resultado, 'LIMPO');
    assert.equal(r.body.dados.ameaca, null);
    assert.equal(r.body.dados.tamanho, conteudo.length);
    assert.equal(r.body.dados.sha256, createHash('sha256').update(conteudo).digest('hex'));
    assert.equal(r.body.dados.nome, 'relatorio.txt', 'nunca guarda caminho, só o nome');
    assert.equal(recebidoPeloClamd, conteudo.length, 'o antivírus recebeu o arquivo inteiro');
    assert.doesNotMatch(JSON.stringify(r.body), /seguro/i);
    const reg = await prisma.fileScan.findUnique({ where: { id: r.body.dados.id } });
    assert.equal(reg?.userId, colabId);
    assert.ok(await prisma.auditLog.findFirst({ where: { usuarioId: colabId, acao: 'ANALISAR_ARQUIVO' } }));
  });

  it('arquivo de teste EICAR: 201 com a ameaça nomeada', async () => {
    const r = await enviarArquivo(analista, EICAR, 'eicar.com');
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.resultado, 'AMEACA');
    assert.equal(r.body.dados.ameaca, 'Eicar-Signature');
    assert.equal(r.body.mensagem, 'Ameaça encontrada: Eicar-Signature');
  });

  it('a resposta nunca devolve o conteúdo do arquivo', async () => {
    const r = await enviarArquivo(colab, 'conteudo-secreto-do-arquivo', 'x.txt');
    assert.doesNotMatch(JSON.stringify(r.body), /conteudo-secreto/);
  });

  it('acima de 10 MB: 413 ARQUIVO_MUITO_GRANDE e nada é registrado', async () => {
    const antes = await prisma.fileScan.count();
    const r = await enviarArquivo(admin, Buffer.alloc(10 * 1024 * 1024 + 1, 65), 'grande.bin');
    assert.equal(r.status, 413, JSON.stringify(r.body));
    assert.equal(r.body.codigoErro, 'ARQUIVO_MUITO_GRANDE');
    assert.equal(await prisma.fileScan.count(), antes);
  });

  it('exatamente 10 MB passa', async () => {
    const r = await enviarArquivo(admin, Buffer.alloc(10 * 1024 * 1024, 66), 'limite.bin');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.tamanho, 10 * 1024 * 1024);
  });

  it('sem arquivo, campo errado ou corpo JSON: 400 ARQUIVO_OBRIGATORIO', async () => {
    for (const r of [await enviarArquivo(colab, null), await enviarArquivo(colab, 'x', 'a.txt', 'outro')]) {
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.codigoErro, 'ARQUIVO_OBRIGATORIO');
    }
    esperaErro(await chamar('POST', '/arquivos/analise', { token: colab, body: { arquivo: 'texto' } }), 400, 'ARQUIVO_OBRIGATORIO');
  });

  it('sem login: 401', async () => {
    const r = await enviarArquivo(null, 'x');
    assert.equal(r.status, 401);
    assert.equal(r.body.codigoErro, 'TOKEN_AUSENTE');
  });

  it('antivírus não configurado ou fora do ar: 503 ANTIVIRUS_INDISPONIVEL, sem registro', async () => {
    const antes = await prisma.fileScan.count();
    const host = process.env.CLAMAV_HOST;
    delete process.env.CLAMAV_HOST;
    try {
      const r = await enviarArquivo(colab, 'x');
      assert.equal(r.status, 503);
      assert.equal(r.body.codigoErro, 'ANTIVIRUS_INDISPONIVEL');
    } finally {
      process.env.CLAMAV_HOST = host;
    }
    const porta = process.env.CLAMAV_PORT;
    process.env.CLAMAV_PORT = '1';
    try {
      const r = await enviarArquivo(colab, 'x');
      assert.equal(r.status, 503);
      assert.equal(r.body.codigoErro, 'ANTIVIRUS_INDISPONIVEL');
    } finally {
      process.env.CLAMAV_PORT = porta;
    }
    assert.equal(await prisma.fileScan.count(), antes);
  });

  it('limite de 20 análises por hora por usuário: 429 MUITAS_ANALISES (os outros não são afetados)', async () => {
    const c = await criarUsuario(admin, 'Colaborador', 'arquivo-limite');
    const token = await login(c.email, SENHA_CONTA);
    await prisma.fileScan.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({ userId: c.id, nome: `f${i}`, tamanho: 1, sha256: 'a'.repeat(64), resultado: 'LIMPO' })),
    });
    const r = await enviarArquivo(token, 'x');
    assert.equal(r.status, 429);
    assert.equal(r.body.codigoErro, 'MUITAS_ANALISES');
    assert.equal((await enviarArquivo(colab, 'y')).status, 201);
  });
});

describe('GET /arquivos/analises', () => {
  it('Colaborador vê só as próprias, sem o campo usuario; operadores veem todas com quem enviou', async () => {
    const proprias = await chamar('GET', '/arquivos/analises', { token: colab });
    assert.equal(proprias.status, 200);
    assert.ok(proprias.body.dados.length > 0);
    for (const a of proprias.body.dados) assert.equal(a.usuario, undefined);
    const doColabNoBanco = await prisma.fileScan.count({ where: { userId: colabId } });
    assert.equal(proprias.body.dados.length, doColabNoBanco);

    const todas = await chamar('GET', '/arquivos/analises', { token: analista });
    assert.equal(todas.body.dados.length, await prisma.fileScan.count());
    assert.ok(todas.body.dados.every((a: any) => a.usuario?.email));
    // Mais recente primeiro.
    const datas = todas.body.dados.map((a: any) => new Date(a.analisadoEm).getTime());
    assert.deepEqual(datas, [...datas].sort((x, y) => y - x));
  });

  it('sem login: 401', async () => {
    esperaErro(await chamar('GET', '/arquivos/analises'), 401, 'TOKEN_AUSENTE');
  });
});
