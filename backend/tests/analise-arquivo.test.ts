// Testes de integracao da analise de arquivos (B04): API real + Postgres isolado (helpers.ts)
// e um clamd FALSO em TCP local que fala o protocolo INSTREAM e reconhece o EICAR. O ClamAV
// de verdade (3 a 4 GiB de RAM) fica para o teste manual com `--profile antivirus`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { ADMIN, ANALISTA, SENHA_CONTA, criarUsuario, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, urlBase, chamar } from './helpers.js';
import { enviarArquivoEmFluxo, lerInstream } from './envioEmFluxo.js';
import { MARCADOR_TESTE, montarZip } from './zipDeTeste.js';

prepararBanco(import.meta.url);

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
let clamd: Server;
let recebidoPeloClamd = 0;

/** clamd falso em fluxo (envioEmFluxo.ts): conta o total e olha so o comeco do arquivo. */
function falsoClamd(socket: Socket) {
  lerInstream(socket, (amostra, total) => {
    recebidoPeloClamd = total;
    socket.end(amostra.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0');
  });
}

/** SHA-256 de `tamanho` bytes iguais a `byte`, calculado em blocos (sem montar o arquivo). */
function sha256Repetido(byte: number, tamanho: number) {
  const h = createHash('sha256');
  const bloco = Buffer.alloc(1024 * 1024, byte);
  for (let falta = tamanho; falta > 0; falta -= bloco.length) h.update(falta >= bloco.length ? bloco : bloco.subarray(0, falta));
  return h.digest('hex');
}

/** Limite real da API (250 MB), sem copia do numero: o teste acompanha a constante. */
const { LIMITE_ARQUIVO_BYTES } = await import('../src/models/analiseArquivo.model.js');

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
    // Sem VIRUSTOTAL_API_KEY a segunda opinião (B20) fica desligada e nada sai para fora.
    assert.equal(r.body.dados.segundaOpiniao.situacao, 'DESLIGADO');
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

  // Os dois testes do limite geram o corpo em fluxo (envioEmFluxo.ts): 250 MB nunca ficam
  // inteiros na memoria, nem do teste nem do clamd falso.
  it('o limite é de 250 MB (MB de 1024 × 1024 bytes)', () => {
    assert.equal(LIMITE_ARQUIVO_BYTES, 250 * 1024 * 1024);
  });

  it('acima de 250 MB: 413 ARQUIVO_MUITO_GRANDE com a mensagem do limite, e nada é registrado', async () => {
    const antes = await prisma.fileScan.count();
    const r = await enviarArquivoEmFluxo({ token: admin, tamanho: LIMITE_ARQUIVO_BYTES + 1 });
    assert.equal(r.status, 413, JSON.stringify(r.body));
    assert.equal(r.body.codigoErro, 'ARQUIVO_MUITO_GRANDE');
    assert.equal(r.body.mensagem, 'Arquivo maior que o limite de 250 MB');
    assert.equal(await prisma.fileScan.count(), antes);
  });

  it('exatamente 250 MB passa, o antivírus recebe o arquivo inteiro e a memória não cresce junto', async () => {
    // Cliente, API e clamd falso estao no mesmo processo: se algum deles juntasse o arquivo, o
    // RSS subiria pelo menos 250 MB. Em fluxo, o pico medido ficou bem abaixo do teto de 128 MB.
    global.gc?.();
    const base = process.memoryUsage().rss;
    let pico = base;
    const amostra = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 20);
    try {
      const r = await enviarArquivoEmFluxo({ token: admin, tamanho: LIMITE_ARQUIVO_BYTES, nome: 'limite.bin', byte: 66 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.dados.tamanho, LIMITE_ARQUIVO_BYTES);
      assert.equal(recebidoPeloClamd, LIMITE_ARQUIVO_BYTES);
      assert.equal(r.body.dados.sha256, sha256Repetido(66, LIMITE_ARQUIVO_BYTES), 'SHA-256 do arquivo inteiro');
    } finally {
      clearInterval(amostra);
    }
    const cresceuMb = (pico - base) / 1024 / 1024;
    console.log(`[memoria] 250 MB em fluxo: RSS subiu ${cresceuMb.toFixed(1)} MB`);
    assert.ok(cresceuMb < 128, `RSS subiu ${cresceuMb.toFixed(1)} MB durante o envio de 250 MB`);
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

  it('clamd que passa do StreamMaxLength ("INSTREAM size limit exceeded") no meio do envio: 503, nunca LIMPO, sem registro', async () => {
    // Como o clamd real (medido em 19/10/2026 com a configuracao da main, StreamMaxLength padrao):
    // ao passar do limite ele responde a recusa ANTES do fim do envio e fecha a conexao, sem ter
    // lido a cauda do arquivo. Aqui o limite falso e de 1 MB e o arquivo tem 3 MB. Duas formas de
    // fechar: com FIN (end) e derrubando a conexao (destroy, o cliente ve ECONNRESET/EPIPE).
    // A terceira forma (le tudo e so recusa no fim) esta no teste de unidade do cliente.
    const LIMITE_FALSO = 1024 * 1024;
    for (const fechamento of ['end', 'destroy'] as const) {
      const limitado = createServer({ allowHalfOpen: true }, (socket) => {
        let recebidos = 0;
        let recusou = false;
        socket.on('data', (d) => {
          recebidos += d.length;
          if (recusou || recebidos <= LIMITE_FALSO) return;
          recusou = true;
          socket.write('INSTREAM size limit exceeded. ERROR\0', () => {
            if (fechamento === 'end') socket.end();
            else socket.destroy();
          });
        });
        socket.on('error', () => undefined);
      });
      await new Promise<void>((ok) => limitado.listen(0, '127.0.0.1', ok));
      const porta = process.env.CLAMAV_PORT;
      process.env.CLAMAV_PORT = String((limitado.address() as AddressInfo).port);
      const antes = await prisma.fileScan.count();
      try {
        const r = await enviarArquivoEmFluxo({ token: admin, tamanho: 3 * 1024 * 1024, nome: `estouro-${fechamento}.txt` });
        assert.equal(r.status, 503, `${fechamento}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.codigoErro, 'ANTIVIRUS_INDISPONIVEL');
        assert.notEqual(r.body.dados?.resultado, 'LIMPO');
      } finally {
        process.env.CLAMAV_PORT = porta;
        await new Promise<void>((ok) => limitado.close(() => ok()));
      }
      assert.equal(await prisma.fileScan.count(), antes, `${fechamento}: nenhuma análise registrada`);
    }
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

// DT27: o ClamAV 1.5.4 nao le a entrada cujo cabecalho local traz 0xFFFFFFFF num tamanho sem
// descritor de dados (Cisco-Talos/clamav#1527) e responde "OK" sem ter lido (medido com o clamd
// real: tests/regressao-clamd-zip64.test.ts). O clamd falso daqui so reconhece o marcador em texto
// puro, e dentro de uma entrada comprimida ele nao aparece: o AMEACA tem de vir da API. As formas
// de Zip64 que o clamd le seguem o veredito dele.
describe('POST /arquivos/analise: o Zip64 que o clamd não lê vira ameaça por precaução (DT27)', () => {
  let token = '';
  let usuarioId = '';
  before(async () => {
    const u = await criarUsuario(admin, 'Colaborador', 'zip64');
    token = await login(u.email, SENHA_CONTA);
    usuarioId = u.id;
  });

  const marcador = [{ nome: 'leia.txt', dados: MARCADOR_TESTE }];

  it('Zip64 com 0xFFFFFFFF no cabeçalho local, sem descritor, e o marcador inofensivo: 201 AMEACA Baluarte.Zip64.NaoAnalisavel, com o rótulo, registro e auditoria', async () => {
    const zip = montarZip(marcador, { zip64Local: true });
    const r = await enviarArquivo(token, zip, 'marcador-zip64.zip');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.resultado, 'AMEACA');
    assert.equal(r.body.dados.ameaca, 'Baluarte.Zip64.NaoAnalisavel');
    assert.equal(
      r.body.mensagem,
      'Ameaça encontrada: Baluarte.Zip64.NaoAnalisavel (formato Zip64, que o antivírus não analisa; tratado como ameaça por precaução)',
    );
    assert.equal(r.body.dados.regraPropria, false);
    assert.equal(recebidoPeloClamd, zip.length, 'o antivírus continua recebendo o arquivo inteiro');
    const reg = await prisma.fileScan.findUnique({ where: { id: r.body.dados.id } });
    assert.equal(reg?.resultado, 'AMEACA');
    assert.equal(reg?.ameaca, 'Baluarte.Zip64.NaoAnalisavel');
    const auditoria = await prisma.auditLog.findFirst({ where: { usuarioId, acao: 'ANALISAR_ARQUIVO' }, orderBy: { sequencia: 'desc' } });
    assert.match(auditoria?.detalhe ?? '', /AMEACA Baluarte\.Zip64\.NaoAnalisavel/);
  });

  it('docx Zip64 (container zip) e Zip64 comprimido dentro de zip comum também caem', async () => {
    const docx = montarZip([{ nome: '[Content_Types].xml', dados: Buffer.from('<Types/>') }, { nome: 'word/document.xml', dados: MARCADOR_TESTE }], { zip64Local: true });
    const aninhado = montarZip([{ nome: 'interno.zip', dados: montarZip(marcador, { zip64Local: true }) }]);
    for (const [nome, dados] of [['relatorio.docx', docx], ['pacote.zip', aninhado]] as const) {
      const r = await enviarArquivo(token, dados, nome);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.dados.resultado, 'AMEACA', nome);
      assert.equal(r.body.dados.ameaca, 'Baluarte.Zip64.NaoAnalisavel', nome);
    }
  });

  it('Zip64 que o clamd lê (NetBeans, Info-ZIP por pipe, só no central/EOCD64) segue o veredito dele: LIMPO aqui', async () => {
    for (const o of [{ zip64TamanhosReais: true }, { zip64Local: true, descritor: true }, { zip64Central: true, fim64: true }]) {
      const r = await enviarArquivo(token, montarZip(marcador, o), 'zip64-lido.zip');
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.dados.resultado, 'LIMPO', JSON.stringify(o));
      assert.equal(r.body.dados.ameaca, null, JSON.stringify(o));
    }
  });

  it('controle: zip comum segue o caminho normal (limpo quando o clamd diz OK, a detecção dele quando acha)', async () => {
    const limpo = await enviarArquivo(token, montarZip(marcador), 'comum.zip');
    assert.equal(limpo.status, 201, JSON.stringify(limpo.body));
    assert.equal(limpo.body.dados.resultado, 'LIMPO');
    assert.equal(limpo.body.dados.ameaca, null);
    assert.equal(limpo.body.mensagem, 'Nenhuma ameaça conhecida encontrada');
    // Marcador guardado sem compressao: o clamd falso o ve e a deteccao dele vale como veio.
    const detectado = await enviarArquivo(token, montarZip([{ nome: 'leia.txt', dados: MARCADOR_TESTE, metodo: 'guardado' }]), 'comum-guardado.zip');
    assert.equal(detectado.body.dados.ameaca, 'Eicar-Signature');
  });

  it('Zip64 em que o clamd também acha algo: fica o nome do clamd (diz mais que o do formato)', async () => {
    const r = await enviarArquivo(token, Buffer.concat([Buffer.from(EICAR), montarZip(marcador, { zip64Local: true })]), 'eicar-e-zip64.bin');
    assert.equal(r.body.dados.resultado, 'AMEACA');
    assert.equal(r.body.dados.ameaca, 'Eicar-Signature');
  });
});

describe('GET /arquivos/analises', () => {
  it('Colaborador vê só as próprias, sem o campo usuario; operadores veem todas com quem enviou', async () => {
    const proprias = await chamar('GET', '/arquivos/analises?tamanho=100', { token: colab });
    assert.equal(proprias.status, 200);
    assert.ok(proprias.body.dados.length > 0);
    for (const a of proprias.body.dados) assert.equal(a.usuario, undefined);
    const doColab = await prisma.fileScan.findMany({ where: { userId: colabId }, select: { id: true } });
    assert.equal(proprias.body.resumo.total, doColab.length);
    const idsDoColab = new Set(doColab.map((r) => r.id));
    assert.ok(proprias.body.dados.every((a: any) => idsDoColab.has(a.id)), 'só análises do próprio Colaborador');

    for (const token of [analista, admin]) {
      const todas = await chamar('GET', '/arquivos/analises?tamanho=100', { token });
      assert.equal(todas.body.resumo.total, await prisma.fileScan.count());
      assert.ok(todas.body.dados.every((a: any) => a.usuario?.email));
      // Mais recente primeiro.
      const datas = todas.body.dados.map((a: any) => new Date(a.analisadoEm).getTime());
      assert.deepEqual(datas, [...datas].sort((x, y) => y - x));
    }
  });

  it('sem login: 401', async () => {
    esperaErro(await chamar('GET', '/arquivos/analises'), 401, 'TOKEN_AUSENTE');
  });
});

describe('GET /arquivos/analises: filtro por resultado e paginação (B17)', () => {
  let dono = '';
  let donoId = '';
  let outro = '';
  const AMEACAS = 7;
  const LIMPOS = 18;
  const TOTAL = AMEACAS + LIMPOS;
  const nomeHist = (i: number) => `hist-${String(i).padStart(2, '0')}.bin`;

  before(async () => {
    const c = await criarUsuario(admin, 'Colaborador', 'historico');
    dono = await login(c.email, SENHA_CONTA);
    donoId = c.id;
    const o = await criarUsuario(admin, 'Colaborador', 'historico-outro');
    outro = await login(o.email, SENHA_CONTA);
    // Instantes distintos (um minuto entre cada), fora da janela de 1 h do limite de envio.
    const base = Date.now() - 2 * 60 * 60 * 1000;
    await prisma.fileScan.createMany({
      data: Array.from({ length: TOTAL }, (_, i) => {
        const ameaca = i % 4 === 0 && i < AMEACAS * 4; // 0, 4, 8, ..., 24: sete ameaças
        return {
          userId: donoId,
          nome: nomeHist(i),
          tamanho: i,
          sha256: createHash('sha256').update(`historico-${i}`).digest('hex'),
          resultado: ameaca ? 'AMEACA' : 'LIMPO',
          ameaca: ameaca ? 'Teste-Signature' : null,
          criadoEm: new Date(base - i * 60_000),
        };
      }),
    });
    assert.equal(await prisma.fileScan.count({ where: { userId: donoId, resultado: 'AMEACA' } }), AMEACAS);
  });

  it('sem parâmetros: dados continua uma lista (formato antigo), com a primeira página de 20 e o total no resumo', async () => {
    const r = await chamar('GET', '/arquivos/analises', { token: dono });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.dados));
    assert.equal(r.body.dados.length, 20);
    assert.deepEqual(r.body.resumo, { total: TOTAL, pagina: 1, tamanho: 20 });
    assert.equal(r.body.dados[0].nome, nomeHist(0), 'a mais recente primeiro');
  });

  it('as páginas cobrem todas as análises, sem repetir nem pular, mais recente primeiro', async () => {
    const vistos: string[] = [];
    for (let pagina = 1; pagina <= 3; pagina++) {
      const r = await chamar('GET', `/arquivos/analises?pagina=${pagina}&tamanho=10`, { token: dono });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.resumo, { total: TOTAL, pagina, tamanho: 10 });
      assert.equal(r.body.dados.length, pagina < 3 ? 10 : 5);
      vistos.push(...r.body.dados.map((a: any) => a.nome));
    }
    assert.deepEqual(vistos, Array.from({ length: TOTAL }, (_, i) => nomeHist(i)));
    const alem = await chamar('GET', '/arquivos/analises?pagina=4&tamanho=10', { token: dono });
    assert.equal(alem.status, 200);
    assert.deepEqual(alem.body.dados, []);
    assert.equal(alem.body.resumo.total, TOTAL);
    const tudo = await chamar('GET', '/arquivos/analises?tamanho=100', { token: dono });
    assert.equal(tudo.body.dados.length, TOTAL);
  });

  it('filtra por resultado (LIMPO | AMEACA), com o total do filtro', async () => {
    const ameacas = await chamar('GET', '/arquivos/analises?resultado=AMEACA&tamanho=100', { token: dono });
    assert.equal(ameacas.status, 200);
    assert.equal(ameacas.body.resumo.total, AMEACAS);
    assert.equal(ameacas.body.dados.length, AMEACAS);
    assert.ok(ameacas.body.dados.every((a: any) => a.resultado === 'AMEACA' && a.ameaca === 'Teste-Signature'));

    const limpos = await chamar('GET', '/arquivos/analises?resultado=LIMPO&pagina=2&tamanho=10', { token: dono });
    assert.deepEqual(limpos.body.resumo, { total: LIMPOS, pagina: 2, tamanho: 10 });
    assert.equal(limpos.body.dados.length, LIMPOS - 10);
    assert.ok(limpos.body.dados.every((a: any) => a.resultado === 'LIMPO' && a.ameaca === null));

    // Vazio conta como ausente (como na auditoria).
    const vazio = await chamar('GET', '/arquivos/analises?resultado=&tamanho=100', { token: dono });
    assert.equal(vazio.status, 200);
    assert.equal(vazio.body.resumo.total, TOTAL);
  });

  it('Colaborador nunca vê as análises de outro, nem com filtro ou parâmetro de dono na query', async () => {
    for (const q of ['?resultado=AMEACA', '?tamanho=100', `?userId=${donoId}`, `?usuarioId=${donoId}&tamanho=100`]) {
      const r = await chamar('GET', `/arquivos/analises${q}`, { token: outro });
      assert.equal(r.status, 200, q);
      assert.equal(r.body.resumo.total, 0, q);
      assert.deepEqual(r.body.dados, [], q);
    }
  });

  it('Administrador e Analista veem as de todos no filtro, com quem enviou', async () => {
    for (const token of [admin, analista]) {
      const r = await chamar('GET', '/arquivos/analises?resultado=AMEACA&tamanho=100', { token });
      assert.equal(r.status, 200);
      assert.equal(r.body.resumo.total, await prisma.fileScan.count({ where: { resultado: 'AMEACA' } }));
      assert.ok(r.body.dados.every((a: any) => a.resultado === 'AMEACA' && a.usuario?.email));
      assert.equal(r.body.dados.filter((a: any) => a.nome.startsWith('hist-')).length, AMEACAS, 'inclui as do Colaborador');
    }
  });

  it('parâmetro inválido: 400 com código próprio, nunca 500 (inclusive objeto e lista na query)', async () => {
    const casos: Array<[string, string]> = [
      ['?resultado=ameaca', 'RESULTADO_INVALIDO'],
      ['?resultado=LIMPA', 'RESULTADO_INVALIDO'],
      ['?resultado[$ne]=x', 'RESULTADO_INVALIDO'],
      ['?resultado=LIMPO&resultado=AMEACA', 'RESULTADO_INVALIDO'],
      ['?pagina=0', 'PAGINA_INVALIDA'],
      ['?pagina=-1', 'PAGINA_INVALIDA'],
      ['?pagina=1.5', 'PAGINA_INVALIDA'],
      ['?pagina=abc', 'PAGINA_INVALIDA'],
      ['?pagina[$gt]=0', 'PAGINA_INVALIDA'],
      ['?tamanho=0', 'TAMANHO_INVALIDO'],
      ['?tamanho=101', 'TAMANHO_INVALIDO'],
      ['?tamanho[$ne]=1', 'TAMANHO_INVALIDO'],
    ];
    for (const [q, codigo] of casos) {
      esperaErro(await chamar('GET', `/arquivos/analises${q}`, { token: dono }), 400, codigo);
    }
  });
});

describe('dashboard: arquivo malicioso conta como crítico no risco técnico (B17)', () => {
  const DIA = 24 * 60 * 60 * 1000;
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');

  /** A regra calculada à parte, direto no banco: SHA-256 distintos com AMEACA nos últimos 30 dias. */
  async function esperado() {
    const linhas = await prisma.fileScan.groupBy({
      by: ['sha256'],
      where: { resultado: 'AMEACA', criadoEm: { gte: new Date(Date.now() - 30 * DIA) } },
    });
    return linhas.length;
  }

  it('o KPI bate com a regra (inclui o EICAR enviado acima) e, como KPI técnico, vem null para o Colaborador', async () => {
    const painel = (await chamar('GET', '/dashboard', { token: analista })).body.dados;
    const n = await esperado();
    assert.ok(n >= 1, 'o EICAR analisado no começo do arquivo conta');
    assert.equal(painel.kpis.arquivosMaliciosos, n);
    const doColab = await chamar('GET', '/dashboard', { token: colab });
    assert.equal(doColab.status, 200);
    // Mesmo nível de acesso dos KPIs técnicos (B10): o Colaborador recebe null, nunca o número.
    assert.equal(doColab.body.dados.kpis.arquivosMaliciosos, null);
    assert.equal(doColab.body.dados.kpis.criticas, null);
    assert.equal(doColab.body.dados.distribuicaoSeveridade, null);
  });

  it('soma em críticas e no Crítico da distribuição, sem contar o mesmo SHA-256 duas vezes', async () => {
    const antes = (await chamar('GET', '/dashboard', { token: admin })).body.dados;
    const novo = hash('malicioso-b17');
    const c2 = await criarUsuario(admin, 'Colaborador', 'dash-b17');
    const agora = Date.now();
    const ameaca = (userId: string, nome: string, sha256: string, diasAtras: number) => ({
      userId, nome, tamanho: 1, sha256, resultado: 'AMEACA', ameaca: 'Teste-Signature', criadoEm: new Date(agora - diasAtras * DIA),
    });
    await prisma.fileScan.createMany({
      data: [
        // O mesmo arquivo três vezes, por pessoas diferentes (uma delas fora da janela): conta 1.
        ameaca(colabId, 'a.exe', novo, 0.001),
        ameaca(c2.id, 'a-copia.exe', novo, 2),
        ameaca(c2.id, 'a.exe', novo, 40),
        // Outro arquivo malicioso, ainda dentro dos 30 dias: conta 1.
        ameaca(c2.id, 'b.docm', hash('malicioso-b17-outro'), 29),
        // Fora da janela de 30 dias e arquivo limpo: não contam.
        ameaca(c2.id, 'velho.exe', hash('velho-b17'), 31),
        { userId: c2.id, nome: 'limpo.pdf', tamanho: 1, sha256: hash('limpo-b17'), resultado: 'LIMPO', ameaca: null },
      ],
    });

    const depois = (await chamar('GET', '/dashboard', { token: admin })).body.dados;
    assert.equal(depois.kpis.arquivosMaliciosos, antes.kpis.arquivosMaliciosos + 2);
    assert.equal(depois.kpis.arquivosMaliciosos, await esperado());
    assert.equal(depois.kpis.criticas, antes.kpis.criticas + 2);
    assert.equal(depois.distribuicaoSeveridade['Crítico'], antes.distribuicaoSeveridade['Crítico'] + 2);
    assert.equal(depois.distribuicaoSeveridade['Alto'], antes.distribuicaoSeveridade['Alto']);
    // Arquivo malicioso não é vulnerabilidade de ativo: esse total não muda.
    assert.equal(depois.kpis.vulnerabilidadesAbertas, antes.kpis.vulnerabilidadesAbertas);
    const soma = Object.values(depois.distribuicaoSeveridade as Record<string, number>).reduce((a, b) => a + b, 0);
    assert.equal(soma, depois.kpis.vulnerabilidadesAbertas + depois.kpis.arquivosMaliciosos);

    // Enviar de novo, pela API, um arquivo já contado (o EICAR) não muda o KPI.
    assert.equal((await enviarArquivo(admin, EICAR, 'eicar-de-novo.com')).status, 201);
    const outraVez = (await chamar('GET', '/dashboard', { token: admin })).body.dados;
    assert.equal(outraVez.kpis.arquivosMaliciosos, depois.kpis.arquivosMaliciosos);
    assert.equal(outraVez.kpis.criticas, depois.kpis.criticas);
  });
});
