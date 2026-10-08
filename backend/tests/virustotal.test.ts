// Testes de integracao da segunda opiniao do VirusTotal (B20): API real + Postgres isolado
// (helpers.ts), um clamd FALSO em TCP (o mesmo de analise-arquivo.test.ts) e um VirusTotal
// FALSO em HTTP local (VIRUSTOTAL_API_URL). Nenhuma consulta vai ao VirusTotal de verdade.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as criarHttp, type Server as ServidorHttp } from 'node:http';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { ADMIN, ANALISTA, SENHA_CONTA, criarUsuario, encerrarServidor, iniciarServidor, login, prepararBanco, urlBase, chamar } from './helpers.js';

prepararBanco(import.meta.url);

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const CHAVE = 'vt-chave-falsa-integracao-0123456789';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

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
        socket.end(conteudo.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0');
        return;
      }
      if (pos + 4 + n > bruto.length) return;
      partes.push(bruto.subarray(pos + 4, pos + 4 + n));
      pos += 4 + n;
    }
  });
}

// VirusTotal falso: resposta por hash; hash sem regra = 404 (desconhecido).
type Regra = { status: number; stats?: Record<string, number> } | 'mudo';
const regras = new Map<string, Regra>();
let consultas: { metodo?: string; url?: string; chave?: string; corpo: string }[] = [];
function falsoVirusTotal(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let corpo = '';
  req.on('data', (c) => { corpo += c; });
  req.on('end', () => {
    consultas.push({ metodo: req.method, url: req.url, chave: req.headers['x-apikey'] as string | undefined, corpo });
    const regra = regras.get((req.url ?? '').split('/').pop() ?? '') ?? { status: 404 };
    if (regra === 'mudo') return;
    res.writeHead(regra.status, { 'content-type': 'application/json' });
    res.end(regra.stats
      ? JSON.stringify({ data: { attributes: { last_analysis_stats: { 'type-unsupported': 2, timeout: 0, failure: 0, ...regra.stats } } } })
      : JSON.stringify({ error: { code: regra.status === 404 ? 'NotFoundError' : 'Erro', message: 'x' } }));
  });
}

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let clamd: Server;
let virusTotal: ServidorHttp;
let tokens: string[] = [];
let vez = 0;
/** Reveza entre usuarios para nao bater no limite de 20 analises por hora de cada um. */
const proximo = () => tokens[vez++ % tokens.length];

before(async () => {
  clamd = createServer(falsoClamd);
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', ok));
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String((clamd.address() as AddressInfo).port);
  virusTotal = criarHttp(falsoVirusTotal);
  await new Promise<void>((ok) => virusTotal.listen(0, '127.0.0.1', ok));
  process.env.VIRUSTOTAL_API_URL = `http://127.0.0.1:${(virusTotal.address() as AddressInfo).port}/api/v3`;
  process.env.VIRUSTOTAL_API_KEY = CHAVE;
  process.env.VIRUSTOTAL_TIMEOUT_MS = '500';
  await iniciarServidor(app);
  const admin = await login(ADMIN.email, ADMIN.senha);
  tokens = [admin, await login(ANALISTA.email, ANALISTA.senha)];
  for (const p of ['vt1', 'vt2']) tokens.push(await login((await criarUsuario(admin, 'Colaborador', p)).email, SENHA_CONTA));
});

afterEach(async () => {
  consultas = [];
  process.env.VIRUSTOTAL_API_KEY = CHAVE;
  // A cota e global: cada teste comeca com ela vazia.
  await prisma.virusTotalLookup.deleteMany();
});

after(async () => {
  await encerrarServidor();
  virusTotal.closeAllConnections();
  await new Promise<void>((ok) => virusTotal.close(() => ok()));
  await new Promise<void>((ok) => clamd.close(() => ok()));
  await prisma.$disconnect();
});

async function enviarArquivo(conteudo: string, nome = 'arquivo.bin', token = proximo()) {
  const form = new FormData();
  form.append('arquivo', new Blob([conteudo]), nome);
  const r = await fetch(`${urlBase()}/arquivos/analise`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: r.status, body: await r.json() as any };
}

describe('segunda opinião do VirusTotal em POST /arquivos/analise', () => {
  it('com a chave: consulta só pelo hash, depois do ClamAV, e devolve detecções/total e link', async () => {
    const conteudo = 'planilha-detectada-so-pelo-virustotal-conteudo-secreto';
    regras.set(sha(conteudo), { status: 200, stats: { malicious: 40, suspicious: 2, undetected: 20, harmless: 0 } });
    const r = await enviarArquivo(conteudo, 'planilha.xlsx');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    // Uma consulta: GET com o hash no caminho, sem corpo; o conteudo nunca sai.
    assert.equal(consultas.length, 1);
    assert.equal(consultas[0].metodo, 'GET');
    assert.equal(consultas[0].url, `/api/v3/files/${sha(conteudo)}`);
    assert.equal(consultas[0].chave, CHAVE);
    assert.equal(consultas[0].corpo, '');
    assert.doesNotMatch(JSON.stringify(consultas), /conteudo-secreto/);
    const so = r.body.dados.segundaOpiniao;
    assert.equal(so.fonte, 'VirusTotal');
    assert.equal(so.situacao, 'MALICIOSO');
    assert.equal(so.deteccoes, 42);
    assert.equal(so.total, 62);
    assert.equal(so.motivo, null);
    assert.ok(so.consultadoEm);
    assert.equal(so.link, `https://www.virustotal.com/gui/file/${sha(conteudo)}`);
    // O veredito principal e do ClamAV e nao muda por causa do VirusTotal.
    assert.equal(r.body.dados.resultado, 'LIMPO');
    assert.equal(r.body.mensagem, 'Nenhuma ameaça conhecida encontrada');
    assert.doesNotMatch(JSON.stringify(r.body), /seguro/i);
    const reg = await prisma.fileScan.findUnique({ where: { id: r.body.dados.id } });
    assert.equal(reg?.vtSituacao, 'MALICIOSO');
    assert.equal(reg?.vtDeteccoes, 42);
  });

  it('EICAR com VirusTotal sem detecção: o resultado continua AMEACA (ClamAV manda)', async () => {
    regras.set(sha(EICAR), { status: 200, stats: { malicious: 0, suspicious: 0, undetected: 70, harmless: 0 } });
    const r = await enviarArquivo(EICAR, 'eicar.com');
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.resultado, 'AMEACA');
    assert.equal(r.body.mensagem, 'Ameaça encontrada: Eicar-Signature');
    assert.equal(r.body.dados.segundaOpiniao.situacao, 'SEM_DETECCAO');
    assert.equal(r.body.dados.segundaOpiniao.deteccoes, 0);
    assert.equal(r.body.dados.segundaOpiniao.total, 70);
  });

  it('sem a chave: segunda opinião DESLIGADO e nenhuma consulta', async () => {
    delete process.env.VIRUSTOTAL_API_KEY;
    const r = await enviarArquivo('arquivo-sem-chave');
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.segundaOpiniao.situacao, 'DESLIGADO');
    assert.equal(r.body.dados.segundaOpiniao.deteccoes, null);
    assert.equal(consultas.length, 0);
    assert.equal(await prisma.virusTotalLookup.count(), 0, 'desligado não gasta cota');
  });

  it('cache: o mesmo hash não é consultado de novo dentro da validade, nem por outro usuário', async () => {
    const conteudo = 'arquivo-repetido-para-o-cache';
    regras.set(sha(conteudo), { status: 200, stats: { malicious: 0, suspicious: 1, undetected: 60, harmless: 3 } });
    const a = await enviarArquivo(conteudo, 'a.txt', tokens[0]);
    const b = await enviarArquivo(conteudo, 'b.txt', tokens[2]);
    assert.equal(consultas.length, 1, 'a segunda análise veio do cache');
    assert.equal(a.body.dados.segundaOpiniao.situacao, 'SUSPEITO');
    assert.deepEqual(b.body.dados.segundaOpiniao, a.body.dados.segundaOpiniao, 'mesma consulta, mesma data');
    assert.equal(await prisma.virusTotalLookup.count(), 1, 'cache não gasta cota');

    // Passada a validade (24 h por padrão), consulta de novo.
    await prisma.fileScan.updateMany({ where: { sha256: sha(conteudo) }, data: { vtConsultadoEm: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const c = await enviarArquivo(conteudo, 'c.txt');
    assert.equal(consultas.length, 2);
    assert.ok(new Date(c.body.dados.segundaOpiniao.consultadoEm).getTime() > Date.now() - 60_000);
  });

  it('cota por minuto estourada: não consulta e diz "indisponível agora (cota)", sem erro', async () => {
    await prisma.virusTotalLookup.createMany({ data: Array.from({ length: 4 }, () => ({ criadoEm: new Date(Date.now() - 10_000) })) });
    const r = await enviarArquivo('arquivo-sem-cota-no-minuto');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(consultas.length, 0);
    const so = r.body.dados.segundaOpiniao;
    assert.equal(so.situacao, 'INDISPONIVEL');
    assert.equal(so.motivo, 'COTA');
    assert.equal(so.mensagem, 'Segunda opinião indisponível agora (cota)');
    assert.equal(r.body.dados.resultado, 'LIMPO');
    assert.equal(await prisma.virusTotalLookup.count(), 4, 'a tentativa recusada não conta');
  });

  it('cota por dia estourada (500 em 24 h): não consulta; fora da janela de 24 h não conta', async () => {
    const ha = (ms: number) => new Date(Date.now() - ms);
    await prisma.virusTotalLookup.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ criadoEm: ha(2 * 60_000 + i * 1000) })) });
    const r = await enviarArquivo('arquivo-sem-cota-no-dia');
    assert.equal(r.status, 201);
    assert.equal(consultas.length, 0);
    assert.equal(r.body.dados.segundaOpiniao.motivo, 'COTA');

    await prisma.virusTotalLookup.updateMany({ data: { criadoEm: ha(25 * 60 * 60 * 1000) } });
    const r2 = await enviarArquivo('arquivo-com-cota-no-dia-seguinte');
    assert.equal(consultas.length, 1);
    assert.equal(r2.body.dados.segundaOpiniao.situacao, 'DESCONHECIDO');
    assert.equal(await prisma.virusTotalLookup.count(), 1, 'consultas antigas são podadas');
  });

  it('hash desconhecido (404): DESCONHECIDO, sem detecções, e nada além do hash foi enviado', async () => {
    const r = await enviarArquivo('arquivo-que-o-virustotal-nunca-viu');
    assert.equal(r.status, 201);
    assert.equal(consultas.length, 1);
    assert.equal(consultas[0].metodo, 'GET');
    assert.equal(consultas[0].corpo, '');
    const so = r.body.dados.segundaOpiniao;
    assert.equal(so.situacao, 'DESCONHECIDO');
    assert.equal(so.deteccoes, null);
    assert.ok(so.consultadoEm);
    assert.match(so.mensagem, /não foi enviado/);
  });

  it('401, 429 do VirusTotal e tempo esgotado: INDISPONIVEL e a análise do ClamAV segue (201)', async () => {
    const casos: [string, Regra, string][] = [
      ['chave-recusada', { status: 401 }, 'CHAVE_INVALIDA'],
      ['limite-do-vt', { status: 429 }, 'LIMITE_VIRUSTOTAL'],
      ['vt-mudo', 'mudo', 'TEMPO_ESGOTADO'],
    ];
    const erro = console.error;
    console.error = () => undefined;
    try {
      for (const [conteudo, regra, motivo] of casos) {
        regras.set(sha(conteudo), regra);
        const r = await enviarArquivo(conteudo);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.dados.resultado, 'LIMPO');
        assert.equal(r.body.dados.segundaOpiniao.situacao, 'INDISPONIVEL');
        assert.equal(r.body.dados.segundaOpiniao.motivo, motivo);
      }
    } finally {
      console.error = erro;
    }
    // Indisponivel nao entra no cache: com o VirusTotal de volta, consulta de novo.
    regras.set(sha('chave-recusada'), { status: 200, stats: { malicious: 0, suspicious: 0, undetected: 50, harmless: 10 } });
    consultas = [];
    const r = await enviarArquivo('chave-recusada');
    assert.equal(consultas.length, 1);
    assert.equal(r.body.dados.segundaOpiniao.situacao, 'SEM_DETECCAO');
  });
});

describe('GET /arquivos/analises com a segunda opinião', () => {
  it('o histórico traz a segunda opinião guardada (null nas análises anteriores ao B20)', async () => {
    const conteudo = 'arquivo-do-historico';
    regras.set(sha(conteudo), { status: 200, stats: { malicious: 3, suspicious: 0, undetected: 60, harmless: 0 } });
    const enviada = await enviarArquivo(conteudo, 'historico.txt', tokens[1]);
    const antiga = await prisma.fileScan.create({
      data: { userId: (await prisma.user.findFirstOrThrow({ where: { email: ANALISTA.email } })).id, nome: 'antiga.txt', tamanho: 1, sha256: 'b'.repeat(64), resultado: 'LIMPO' },
    });
    const r = await chamar('GET', '/arquivos/analises', { token: tokens[1] });
    assert.equal(r.status, 200);
    const nova = r.body.dados.find((a: any) => a.id === enviada.body.dados.id);
    assert.deepEqual(nova.segundaOpiniao, enviada.body.dados.segundaOpiniao);
    assert.equal(nova.segundaOpiniao.situacao, 'MALICIOSO');
    assert.equal(r.body.dados.find((a: any) => a.id === antiga.id).segundaOpiniao, null);
  });
});
