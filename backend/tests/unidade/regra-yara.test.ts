// Testes de UNIDADE do B23: o veredito de regra YARA propria do Baluarte vira o rotulo
// "regra propria do Baluarte", e as regras de antivirus/regras/ respeitam os limites do ClamAV
// (sem ClamAV aqui: o teste com o clamd de verdade esta em scripts/validar-regras-yara.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerVeredito } from '../../src/config/antivirus.js';
import {
  MENSAGEM_LIMPO, ROTULO_LIMITE_EXCEDIDO, ROTULO_REGRA_PROPRIA, ehLimiteExcedido, ehRegraPropria, mensagemDoResultado,
} from '../../src/models/analiseArquivo.model.js';

describe('limite do antivírus excedido -> ameaça por precaução (AlertExceedsMax, Melhorias #18)', () => {
  it('o clamd devolve o limite excedido como ameaça, e ela vira AMEACA', () => {
    assert.deepEqual(lerVeredito('stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND' + String.fromCharCode(0)), {
      resultado: 'AMEACA',
      ameaca: 'Heuristics.Limits.Exceeded.MaxFileSize',
    });
  });

  it('só os nomes Heuristics.Limits.Exceeded[.<Limite>] contam como limite excedido', () => {
    for (const nome of [
      'Heuristics.Limits.Exceeded.MaxFileSize',
      'Heuristics.Limits.Exceeded.MaxScanSize',
      'Heuristics.Limits.Exceeded.MaxRecursion',
      'Heuristics.Limits.Exceeded.MaxFiles',
      'Heuristics.Limits.Exceeded',
    ]) assert.equal(ehLimiteExcedido(nome), true, nome);
    for (const nome of [
      'Heuristics.Encrypted.Zip',
      'Heuristics.Limits.Exceeded.Max.File',
      'xHeuristics.Limits.Exceeded.MaxFileSize',
      'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
      'Eicar-Signature',
      '',
      null,
      undefined,
    ]) assert.equal(ehLimiteExcedido(nome), false, String(nome));
  });

  it('a mensagem explica o nome técnico e não diz "seguro"', () => {
    assert.equal(ROTULO_LIMITE_EXCEDIDO, 'passa dos limites de análise do antivírus; tratado como ameaça por precaução');
    const msg = mensagemDoResultado('Heuristics.Limits.Exceeded.MaxScanSize');
    assert.equal(
      msg,
      'Ameaça encontrada: Heuristics.Limits.Exceeded.MaxScanSize (passa dos limites de análise do antivírus; tratado como ameaça por precaução)',
    );
    assert.doesNotMatch(msg, /seguro|regra própria/i);
  });
});

describe('veredito com nome de regra YARA -> rótulo (B23)', () => {
  it('o clamd devolve o nome da regra YARA como ameaça', () => {
    assert.deepEqual(lerVeredito('stream: YARA.BaluarteMacroSuspeita.UNOFFICIAL FOUND\0'), {
      resultado: 'AMEACA',
      ameaca: 'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
    });
  });

  it('regras do Baluarte são próprias; assinaturas oficiais e YARA de terceiros, não', () => {
    for (const nome of [
      'YARA.BaluarteMarcadorTeste.UNOFFICIAL',
      'YARA.BaluarteMacroSuspeita.UNOFFICIAL',
      'YARA.BaluartePowerShellBaixaExecuta.UNOFFICIAL',
      'YARA.BaluarteLnkPayloadBase64.UNOFFICIAL',
      'YARA.BaluarteHtmlPayloadBase64.UNOFFICIAL',
    ]) assert.equal(ehRegraPropria(nome), true, nome);
    for (const nome of [
      'Eicar-Signature',
      'Win.Test.EICAR_HDB-1',
      'YARA.OutraEmpresaMacro.UNOFFICIAL', // regra de terceiros no mesmo diretório
      'YARA.BaluarteMacroSuspeita', // sem o sufixo do ClamAV
      'xYARA.BaluarteMacroSuspeita.UNOFFICIAL',
      'YARA.Baluarte.Macro.UNOFFICIAL',
      'Heuristics.Encrypted.Zip',
      '',
      null,
      undefined,
    ]) assert.equal(ehRegraPropria(nome), false, String(nome));
  });

  it('a mensagem leva o rótulo só na regra própria e nunca diz "seguro"', () => {
    assert.equal(ROTULO_REGRA_PROPRIA, 'regra própria do Baluarte');
    assert.equal(
      mensagemDoResultado('YARA.BaluarteMarcadorTeste.UNOFFICIAL'),
      'Ameaça encontrada: YARA.BaluarteMarcadorTeste.UNOFFICIAL (regra própria do Baluarte)',
    );
    assert.equal(mensagemDoResultado('Eicar-Signature'), 'Ameaça encontrada: Eicar-Signature');
    assert.equal(mensagemDoResultado(null), MENSAGEM_LIMPO);
    assert.doesNotMatch(MENSAGEM_LIMPO, /seguro/i);
  });
});

describe('arquivos de antivirus/regras respeitam os limites do ClamAV 1.5 (B23)', () => {
  const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'antivirus', 'regras');
  const arquivos = readdirSync(pasta).filter((a) => /\.ya?ra?$/.test(a));
  // Sem comentarios: o que sobra e o que o ClamAV le.
  const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('existem as regras do cartão, com o prefixo que o compose copia (baluarte_*.yar)', () => {
    assert.deepEqual(arquivos.sort(), [
      'baluarte_macro.yar', 'baluarte_payload_base64.yar', 'baluarte_powershell.yar', 'baluarte_teste.yar',
    ]);
  });

  for (const arquivo of arquivos) {
    const texto = semComentario(readFileSync(join(pasta, arquivo), 'utf8'));
    const regras = [...texto.matchAll(/^\s*rule\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];

    it(`${arquivo}: regras com nome Baluarte* (vira o rótulo de regra própria) e sem recurso que o ClamAV recusa`, () => {
      assert.ok(regras.length > 0, 'ao menos uma regra');
      assert.doesNotMatch(texto, /^\s*import\s/m, 'módulos YARA não são suportados');
      assert.doesNotMatch(texto, /^\s*global\s+rule/m, 'regras globais não são suportadas');
      assert.doesNotMatch(texto, /\b(contains|matches)\b/, 'contains/matches não são suportados');
      for (const [, nome, corpo] of regras) {
        assert.ok(ehRegraPropria(`YARA.${nome}.UNOFFICIAL`), `${nome} precisa começar com Baluarte`);
        const strings = [...corpo.matchAll(/^\s*\$\w*\s*=\s*(.+)$/gm)].map((m) => m[1].trim());
        assert.ok(strings.length >= 1, `${nome}: o ClamAV exige ao menos uma string`);
        assert.ok(strings.length <= 64, `${nome}: no máximo 64 strings`);
        for (const s of strings) {
          // Testado no ClamAV 1.5: `wide` em expressão regular descarta a regra inteira.
          if (s.startsWith('/')) assert.doesNotMatch(s, /\/\s+.*\bwide\b/, `${nome}: wide em regex (${s})`);
          const literal = s.match(/^"((?:[^"\\]|\\.)*)"/);
          if (literal) assert.ok(literal[1].length >= 2, `${nome}: string com menos de 2 bytes (${s})`);
        }
      }
    });
  }
});

// DT26: em HTML o ClamAV pula a varredura crua (DOCUMENT/HTMLSKIPRAW, bit 0x10, ligado por
// padrao) e o YARA so ve o HTML normalizado (minusculas, entidades decodificadas, comentarios
// apagados). O conserto tem duas pecas, conferidas aqui sem ClamAV; o comportamento no clamd de
// verdade esta em tests/aceitacao-clamd-real.test.ts (marcador em HTML e em e-mail com HTML).
describe('marcador em HTML: regra case-insensitive e varredura crua religada (DT26)', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const pasta = join(raiz, 'antivirus', 'regras');
  const semComentario = (t: string) => t.replace(/^\s*(\/\/|#).*$/gm, '');

  it('o marcador tem `nocase`: a forma normalizada é toda em minúsculas', () => {
    const texto = semComentario(readFileSync(join(pasta, 'baluarte_teste.yar'), 'utf8'));
    assert.match(texto, /\$marcador\s*=\s*"BALUARTE-TESTE-AMEACA-0001-ARQUIVO-INOFENSIVO"\s+nocase\s*$/m);
  });

  it('baluarte_html_cru.cfg: uma linha DOCUMENT que desliga só o HTMLSKIPRAW (0x10) e mantém o resto ligado', () => {
    const linhas = semComentario(readFileSync(join(pasta, 'baluarte_html_cru.cfg'), 'utf8')).split(/\r?\n/).filter((l) => l.trim());
    assert.equal(linhas.length, 1, 'uma linha só, para nenhuma outra sobrescrever a configuração oficial');
    const m = /^DOCUMENT:0x([0-9a-f]+):(\d+)$/i.exec(linhas[0].trim());
    assert.ok(m, `formato MODULO:0xMASCARA:nivel_minimo (sem nível máximo): ${linhas[0]}`);
    const mascara = parseInt(m[1], 16);
    assert.equal(mascara & 0x10, 0, 'HTMLSKIPRAW desligado: o HTML também é varrido cru');
    // HTML, RTF, PDF, SCRIPT, JSNORM, SWF, MSXML, OOXML, HWP, ONENOTE: nenhum submódulo existente desligado.
    for (const bit of [0x1, 0x2, 0x4, 0x8, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400]) {
      assert.notEqual(mascara & bit, 0, `submódulo 0x${bit.toString(16)} de DOCUMENT continua ligado`);
    }
    assert.equal(Number(m[2]), 0, 'vale em qualquer nível de funcionalidade');
  });

  it('o compose copia também os baluarte_*.cfg para o diretório de banco do clamd', () => {
    const compose = readFileSync(join(raiz, 'docker-compose.yml'), 'utf8');
    assert.match(compose, /rm -f [^\n]*\/var\/lib\/clamav\/baluarte_\*\.cfg/);
    assert.match(compose, /for regra in [^\n]*\/regras-baluarte\/baluarte_\*\.cfg/);
  });
});
