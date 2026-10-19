// Teste de REGRESSAO DA IMAGEM do ClamAV para o DT27. So roda com CLAMAV_HOST definido (sem ele,
// o arquivo inteiro fica marcado como pulado; nao usa banco nem a API). Roteiro, com o comando
// para subir o clamd isolado e o resultado medido: docs/CLAMD-LIMITES.md, item 4.
//
// O criterio (iii) do DT27 (utils/detectorZip64.ts) so trata como ameaca a forma de Zip64 que o
// clamd nao le: 0xFFFFFFFF num tamanho do cabecalho LOCAL, sem descritor de dados
// (Cisco-Talos/clamav#1527, medido na 1.5.4). As outras formas ficam com o veredito do clamd,
// porque ele as le. Esse criterio vale enquanto a imagem se comportar assim. Aqui as quatro
// formas vao DIRETO ao clamd (INSTREAM, pelo cliente da API, sem a rota), com o marcador YARA
// inofensivo do Baluarte comprimido dentro (nunca o EICAR, nada em disco):
//   - as tres formas que ele le precisam ser DETECTADAS (se nao forem, a API passou a deixar
//     passar "limpo" sem leitura e o criterio tem de crescer);
//   - a forma 0xFFFFFFFF sem descritor precisa sair "OK" (se for detectada, a imagem corrigiu o
//     #1527 e o Baluarte.Zip64.NaoAnalisavel pode estar sobrando).
// Qualquer mudanca falha com "comportamento do ClamAV mudou: rever o critério do DT27".
//
// Rodar (com o clamd do perfil antivirus no ar, regras do Baluarte carregadas):
//   CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=<porta> node --import tsx --test tests/regressao-clamd-zip64.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analisar } from '../src/config/antivirus.js';
import { MARCADOR_YARA, montarZip, type OpcoesZipDeTeste } from './zipDeTeste.js';

const comClamdReal = Boolean(process.env.CLAMAV_HOST);
const REGRA = 'YARA.BaluarteMarcadorTeste.UNOFFICIAL';
const MUDOU = 'comportamento do ClamAV mudou: rever o critério do DT27';

const entradas = () => [
  { nome: 'leia.txt', dados: Buffer.concat([Buffer.from('conteúdo comum\n'.repeat(200)), MARCADOR_YARA, Buffer.from('\n')]) },
];

async function noClamd(nome: string, o: OpcoesZipDeTeste | Buffer) {
  const zip = Buffer.isBuffer(o) ? o : montarZip(entradas(), o);
  const veredito = await analisar((async function* () { yield zip; })());
  // Linha de registro para o roteiro (docs/CLAMD-LIMITES.md): o desfecho real, aprovado ou nao.
  console.log(`[regressao-clamd-zip64] ${nome}: ${veredito.resultado} ${veredito.ameaca ?? ''}`);
  return veredito;
}

describe('regressão da imagem do ClamAV: as formas de Zip64 do DT27', { skip: comClamdReal ? false : 'sem CLAMAV_HOST (clamd real)' }, () => {
  it('controle: zip comum com o marcador comprimido é detectado (as regras do Baluarte estão carregadas)', async () => {
    const v = await noClamd('zip comum', {});
    assert.equal(v.ameaca, REGRA, 'sem detectar o zip comum o teste não diz nada: confira as regras YARA no clamd');
  });

  const lidas: [string, OpcoesZipDeTeste][] = [
    ['Zip64 com tamanhos reais no cabeçalho local e extra 0x0001 (NetBeans)', { zip64TamanhosReais: true }],
    ['Zip64 com descritor de dados (Info-ZIP por pipe)', { zip64Local: true, descritor: true }],
    ['Zip64 só no diretório central e no EOCD64', { zip64Central: true, fim64: true }],
  ];
  for (const [nome, o] of lidas) {
    it(`${nome}: o clamd lê e detecta`, async () => {
      const v = await noClamd(nome, o);
      assert.equal(v.resultado, 'AMEACA', `${MUDOU} (o clamd deixou de ler: ${nome})`);
      assert.equal(v.ameaca, REGRA, `${MUDOU} (${nome}: ${v.ameaca})`);
    });
  }

  it('0xFFFFFFFF no cabeçalho local, sem descritor (Python force_zip64, 7-Zip -si): o clamd NÃO lê ("OK")', async () => {
    const v = await noClamd('Zip64 0xFFFFFFFF no local, sem descritor', { zip64Local: true });
    assert.equal(v.resultado, 'LIMPO', `${MUDOU} (a forma não lida passou a ser lida: ${v.ameaca})`);
  });

  it('a mesma forma sem o campo extra Zip64 (montada à mão): também "OK" (por isso o detector não exige o extra)', async () => {
    const zip = Buffer.from(montarZip(entradas()));
    zip.writeUInt32LE(0xffffffff, 18);
    zip.writeUInt32LE(0xffffffff, 22);
    const v = await noClamd('0xFFFFFFFF no local, sem descritor e sem extra Zip64', zip);
    assert.equal(v.resultado, 'LIMPO', `${MUDOU} (sem o extra, o clamd passou a ler: ${v.ameaca})`);
  });
});
