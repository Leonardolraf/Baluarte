// -----------------------------------------------------------------------------
// Ofusca os .js de `dist/` depois do build do Vite.
//
// LEIA ANTES DE CONTAR COM ISTO COMO SEGURANÇA: não é. O código roda no navegador
// de quem acessa; ofuscação dificulta a leitura casual e não protege segredo nenhum.
// Quem quiser, desofusca com ferramentas públicas em minutos. Ver SEGURANCA.md.
//
// CUSTO MEDIDO (14/10/2026, build em modo mock): o JavaScript entregue ao navegador sai de
// 193 kB para 429 kB comprimido (+122%) — mais que o dobro de download, numa demo que já
// atravessa um Funnel com ~1 s de latência por requisição. O build ganha ~7 s. A troca é
// essa: mais que o dobro de bytes para dificultar a leitura casual de um código que continua
// inteiro no navegador de quem acessa.
//
// Fica fora do build padrão de propósito: só roda com OFUSCAR=1 (`npm run build:ofuscado`).
// Assim a Vercel só passa a publicar bundle ofuscado quando alguém definir a variável,
// e desligar é remover a variável — sem tocar em código.
//
// Opções escolhidas pelo que NÃO quebram:
//  - sem `controlFlowFlattening` e sem `deadCodeInjection`: multiplicam tamanho e tempo
//    de execução (o próprio projeto documenta o custo de 1 s por rota no Funnel; não
//    vamos pagar mais por nada);
//  - sem `debugProtection`: trava o navegador de quem abre o DevTools, inclusive o da
//    equipe, e não impede leitura — só irrita;
//  - sem `selfDefending`: quebra ao menor reprocessamento do arquivo.
// -----------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// O pacote é CommonJS: importa o default e tira o 'obfuscate' dele.
import ofuscador from 'javascript-obfuscator';

const { obfuscate } = ofuscador;

const PASTA = join(process.cwd(), 'dist', 'assets');

const OPCOES = {
  compact: true,
  identifierNamesGenerator: 'mangled-shuffled',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 10,
  numbersToExpressions: true,
  simplify: true,
  transformObjectKeys: false, // mexe em nomes de propriedade: é onde ofuscador costuma quebrar app
  unicodeEscapeSequence: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  selfDefending: false,
};

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

const arquivos = readdirSync(PASTA).filter((nome) => nome.endsWith('.js'));
if (arquivos.length === 0) {
  console.error('[ofuscar] nenhum .js em dist/assets — rode o build antes.');
  process.exit(1);
}

let antes = 0;
let depois = 0;
const inicio = Date.now();

for (const nome of arquivos) {
  const caminho = join(PASTA, nome);
  const original = readFileSync(caminho, 'utf8');
  antes += statSync(caminho).size;
  const resultado = obfuscate(original, OPCOES).getObfuscatedCode();
  writeFileSync(caminho, resultado, 'utf8');
  depois += statSync(caminho).size;
}

const crescimento = ((depois / antes - 1) * 100).toFixed(0);
console.log(
  `[ofuscar] ${arquivos.length} arquivos | ${kb(antes)} -> ${kb(depois)} (+${crescimento}%) em ${(
    (Date.now() - inicio) /
    1000
  ).toFixed(1)} s`,
);
console.log('[ofuscar] lembrete: isto dificulta leitura casual; não protege segredo algum.');
