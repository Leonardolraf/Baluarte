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
  MENSAGEM_LIMPO, ROTULO_REGRA_PROPRIA, ehRegraPropria, mensagemDoResultado,
} from '../../src/models/analiseArquivo.model.js';

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
