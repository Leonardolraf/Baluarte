// Pentest em codigo — classes de ataque sem superficie alcancavel no Baluarte, com a evidencia
// guardada como teste (cartao #13 da lista "Melhorias"). Se alguem introduzir ou tornar
// alcancavel a superficie, o teste falha e a classe passa a precisar de teste proprio.
//
//  - Command injection (OWASP A03): o codigo da API nao executa processo nem shell. Nenhum
//    arquivo de src/ importa child_process nem chama exec/execSync/execFile/spawn/fork; o
//    servidor tambem nao avalia codigo (eval, new Function, vm). O agente osquery recebe so as
//    consultas fixas de QUERIES (models/agente.model.ts), nunca texto vindo de requisicao.
//  - XXE (OWASP A05): SUPERFICIE PRESENTE, MAS INALCANCAVEL (deixou de ser "nao aplicavel" com
//    a melhoria #17). Ha um parser de XML no package-lock.json: o saxes 5.0.1 (com o xmlchars),
//    trazido pelo exceljs do relatorio em Excel. O exceljs usa o saxes so para LER planilhas; o
//    Baluarte so ESCREVE (wb.xlsx.writeBuffer em services/relatorioExcel.service.ts) e nunca faz
//    parse de XLSX ou XML vindo de fora. A prova esta nos testes abaixo:
//      1. nenhum arquivo de src/ importa parser de XML (import/require de modulo com "xml" ou
//         "sax" no nome) nem usa DOMParser;
//      2. no lockfile, so saxes e xmlchars (excecao explicita), e so pela cadeia
//         exceljs -> saxes -> xmlchars; qualquer outro pacote de XML quebra o teste;
//      3. so services/relatorioExcel.service.ts importa o exceljs, so com chamadas de escrita,
//         e nenhum arquivo de src/ chama API de leitura (xlsx.read/load/readFile,
//         csv.read/readFile, stream.xlsx.WorkbookReader);
//      4. os parsers de corpo do app sao so JSON: um corpo XML com entidade externa e recusado
//         com 400, sem eco.
//    Segunda camada, conferida no codigo do saxes 5.0.1 (node_modules/saxes/saxes.js): o texto
//    do DOCTYPE/DTD so e percorrido e entregue ao evento "doctype" (sDoctype/sDTD), sem
//    declarar entidade; parseEntity so resolve o que esta em parser.ENTITIES, que nasce com as
//    cinco predefinidas (XML_ENTITIES), e marca "undefined entity." para qualquer outra; o
//    modulo so importa o xmlchars (nada de fs, http ou rede). O README do saxes diz o mesmo
//    (secao "Regarding <!DOCTYPE and <!ENTITY"). O ultimo teste do bloco roda o saxes e confirma.
//    (O ClamAV le arquivos enviados, inclusive formatos com XML, mas roda em outro conteiner
//    e nunca devolve o conteudo; fora do processo da API.)
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { prepararBanco, iniciarServidor, encerrarServidor, urlBase } from '../helpers.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(RAIZ, 'src');

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    return caminho.endsWith('.ts') ? [caminho] : [];
  });
}

/** Linhas de src/ que casam com o padrao, como "arquivo:linha: texto" (comentarios de linha ignorados). */
function ocorrencias(padrao: RegExp): string[] {
  const achados: string[] = [];
  for (const arquivo of arquivosTs(SRC)) {
    readFileSync(arquivo, 'utf8')
      .split('\n')
      .forEach((linha, i) => {
        if (/^\s*(\/\/|\*)/.test(linha)) return;
        if (padrao.test(linha)) achados.push(`${relative(RAIZ, arquivo)}:${i + 1}: ${linha.trim()}`);
      });
  }
  return achados;
}

describe('command injection: nao aplicavel (a API nao executa processo)', () => {
  it('nenhum arquivo de src/ importa child_process (nem por require)', () => {
    assert.ok(arquivosTs(SRC).length > 50, 'sanidade: a varredura encontrou o codigo da API');
    assert.deepEqual(ocorrencias(/(['"])(node:)?child_process\1/), []);
  });

  it('nenhuma chamada a exec/execSync/execFile/spawn/spawnSync/fork (RegExp.exec nao conta)', () => {
    assert.deepEqual(ocorrencias(/(?<![.\w])(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/), []);
  });

  it('nenhuma avaliacao de codigo em tempo de execucao (eval, new Function, modulo vm)', () => {
    assert.deepEqual(ocorrencias(/(?<![.\w])eval\s*\(|new\s+Function\s*\(|(['"])(node:)?vm\1/), []);
  });
});

describe('XXE: superficie presente (saxes pelo exceljs), mas inalcancavel', () => {
  it('nenhum arquivo de src/ importa parser de XML (nem usa DOMParser)', () => {
    assert.deepEqual(ocorrencias(/(\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])[^'"]*(xml|sax)[^'"]*\2|\bDOMParser\b/i), []);
  });

  it('no package-lock.json, so saxes e xmlchars, e so pela cadeia exceljs -> saxes -> xmlchars', () => {
    type Pacote = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    const lock = JSON.parse(readFileSync(join(RAIZ, 'package-lock.json'), 'utf8')) as { packages: Record<string, Pacote> };
    // Excecao explicita: qualquer outro pacote de XML que aparecer quebra o teste.
    const EXCECOES = ['node_modules/saxes', 'node_modules/xmlchars'];
    const pacotesXml = Object.keys(lock.packages).filter((p) => /(^|\/)(node_modules\/)(@[^/]+\/)?[^/]*(xml|sax)[^/]*$/i.test(p));
    assert.deepEqual(pacotesXml.filter((p) => !EXCECOES.includes(p)), []);
    // Quem traz cada um: so o exceljs depende do saxes, e so o saxes depende do xmlchars.
    const dependentes = (nome: string) =>
      Object.entries(lock.packages)
        .filter(([, v]) => nome in { ...v.dependencies, ...v.optionalDependencies, ...v.peerDependencies })
        .map(([k]) => k || '(raiz)');
    assert.deepEqual(dependentes('saxes'), ['node_modules/exceljs']);
    assert.deepEqual(dependentes('xmlchars'), ['node_modules/saxes']);
  });

  it('o exceljs so entra pelo relatorio em Excel, que so escreve (nenhuma API de leitura em src/)', () => {
    const importadores = ocorrencias(/(\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"])exceljs\2/);
    assert.deepEqual(
      importadores.map((l) => l.split(':')[0].replace(/\\/g, '/')),
      ['src/services/relatorioExcel.service.ts'],
    );
    assert.deepEqual(
      ocorrencias(/\.\s*(xlsx|csv)\s*\.\s*(read|load|readFile)\b|\bWorkbookReader\b|\bstream\s*\.\s*xlsx\b|\breadFile\s*\(/),
      [],
    );
    // O uso que existe e de escrita: toda chamada .xlsx.* do relatorio e write*.
    const usos = readFileSync(join(SRC, 'services', 'relatorioExcel.service.ts'), 'utf8').match(/\.xlsx\.\w+/g) ?? [];
    assert.ok(usos.length > 0, 'sanidade: o relatorio usa o exceljs');
    assert.ok(usos.every((u) => u.startsWith('.xlsx.write')), `uso fora de escrita: ${usos.join(', ')}`);
  });

  it('segunda camada: o saxes 5.0.1 nao resolve entidade externa declarada no DTD', () => {
    const exigir = createRequire(join(RAIZ, 'package.json'));
    assert.equal((exigir('saxes/package.json') as { version: string }).version, '5.0.1');
    const { SaxesParser } = exigir('saxes') as {
      SaxesParser: new () => { on(evento: string, fn: (v: unknown) => void): void; write(s: string): { close(): void } };
    };
    const parser = new SaxesParser();
    const erros: string[] = [];
    let texto = '';
    parser.on('error', (e) => erros.push((e as Error).message));
    parser.on('text', (t) => (texto += String(t)));
    parser.write('<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>').close();
    assert.ok(erros.some((m) => /undefined entity/.test(m)), `erros: ${erros.join(' | ')}`);
    assert.equal(texto, '&x;');
  });

  it('os parsers de corpo do app sao so JSON (nada de express.text/raw/urlencoded)', () => {
    const appTs = readFileSync(join(SRC, 'app.ts'), 'utf8');
    assert.match(appTs, /express\.json\(/);
    assert.doesNotMatch(appTs, /express\.(text|raw|urlencoded)\(/);
  });
});

describe('XXE: corpo XML com entidade externa e recusado pela API real', () => {
  prepararBanco(import.meta.url);
  const XXE =
    '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
    '<login><email>&x;</email><senha>a</senha></login>';
  let encerrar: () => Promise<void>;

  before(async () => {
    const { app } = await import('../../src/app.js');
    await iniciarServidor(app);
    const { prisma } = await import('../../src/config/db.js');
    encerrar = async () => {
      await encerrarServidor();
      await prisma.$disconnect();
    };
  });
  after(() => encerrar());

  async function postarXml(caminho: string) {
    const r = await fetch(urlBase() + caminho, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: XXE });
    const texto = await r.text();
    return { status: r.status, tipo: r.headers.get('content-type') ?? '', texto, corpo: JSON.parse(texto) };
  }

  it('rota comum (POST /login): o XML nao e lido como corpo, 400 de campo obrigatorio', async () => {
    const r = await postarXml('/login');
    assert.equal(r.status, 400);
    assert.match(r.tipo, /^application\/json/);
    assert.equal(r.corpo.codigoErro, 'EMAIL_OBRIGATORIO');
    assert.doesNotMatch(r.texto, /root:|passwd|ENTITY/);
  });

  it('rota do agente (aceita qualquer Content-Type): o XML falha como JSON, 400 JSON_INVALIDO', async () => {
    const r = await postarXml('/agentes/osquery/enroll');
    assert.equal(r.status, 400);
    assert.match(r.tipo, /^application\/json/);
    assert.equal(r.corpo.codigoErro, 'JSON_INVALIDO');
    assert.doesNotMatch(r.texto, /root:|passwd|ENTITY/);
  });
});
