// Testes de UNIDADE do DT27: o detector (utils/detectorZip64.ts) da forma de Zip64 que o ClamAV
// 1.5.4 nao le (0xFFFFFFFF num tamanho do cabecalho LOCAL, sem descritor de dados) e o veredito que
// junta o clamd com ele. As outras formas de Zip64 o clamd le e varre, e o detector nao acusa.
// Sem ClamAV aqui: o comportamento do clamd real em cada forma e conferido em
// tests/regressao-clamd-zip64.test.ts (so com CLAMAV_HOST); a integracao com a rota, em
// analise-arquivo.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DetectorZip64, type OpcoesDetectorZip64 } from '../../src/utils/detectorZip64.js';
import {
  AMEACA_ZIP64, AMEACA_ZIP64_INCOMPLETA, LIMITE_DESCOMPRESSAO_ZIP64_BYTES, MENSAGEM_LIMPO, PROFUNDIDADE_MAXIMA_ZIP64, ROTULO_ZIP64,
  ROTULO_ZIP64_INCOMPLETA, ehLimiteExcedido, ehRegraPropria, ehZip64, mensagemDoResultado, vereditoComZip64,
} from '../../src/models/analiseArquivo.model.js';
import { MARCADOR_TESTE, montarZip, type OpcoesZipDeTeste } from '../zipDeTeste.js';

const PADRAO: OpcoesDetectorZip64 = { limiteDescompressao: LIMITE_DESCOMPRESSAO_ZIP64_BYTES, profundidadeMaxima: PROFUNDIDADE_MAXIMA_ZIP64 };

/** Passa `dados` pelo detector em blocos de `tamanhoBloco` (ou nos cortes dados). */
async function detectar(dados: Buffer, tamanhoBloco = 64 * 1024, opcoes = PADRAO) {
  const d = new DetectorZip64(opcoes);
  for (let p = 0; p < dados.length; p += tamanhoBloco) await d.observar(dados.subarray(p, p + tamanhoBloco));
  return d.finalizar();
}

async function detectarComCortes(dados: Buffer, cortes: number[]) {
  const d = new DetectorZip64(PADRAO);
  let anterior = 0;
  for (const c of [...cortes, dados.length]) {
    await d.observar(dados.subarray(anterior, c));
    anterior = c;
  }
  return d.finalizar();
}

/** Bytes pseudoaleatorios deterministas (xorshift32): o teste falha sempre igual, se falhar. */
function aleatorio(tamanho: number, semente = 0x2f6b9a1d): Buffer {
  const b = Buffer.alloc(tamanho);
  let x = semente >>> 0;
  for (let i = 0; i < tamanho; i += 4) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    b.writeUInt32LE(x, i);
  }
  return b;
}

const SEM_ZIP64 = { zip64: false, incompleta: false };
const COM_ZIP64 = { zip64: true, incompleta: false };
const texto = (s: string) => Buffer.from(s, 'utf8');
const leia = (dados = MARCADOR_TESTE) => [{ nome: 'leia.txt', dados }];

/**
 * 0xFFFFFFFF nos dois tamanhos do cabecalho local em `posicao`, sem campo extra Zip64 nenhum: a
 * forma montada a mao por quem quer desviar (o clamd falha do mesmo jeito; o extra nao e exigido).
 */
function semTamanhoNoLocal(zip: Buffer, posicao = 0): Buffer {
  const b = Buffer.from(zip);
  assert.equal(b.readUInt32LE(posicao), 0x04034b50, 'cabeçalho local na posição');
  b.writeUInt32LE(0xffffffff, posicao + 18);
  b.writeUInt32LE(0xffffffff, posicao + 22);
  return b;
}

/** A forma que o clamd nao le: vira Baluarte.Zip64.NaoAnalisavel. */
const NAO_LIDAS: [string, () => Buffer][] = [
  ['0xFFFFFFFF no cabeçalho local, sem descritor (Python force_zip64, 7-Zip -si)', () => montarZip(leia(), { zip64Local: true })],
  ['a mesma, com um campo extra comum antes do Zip64', () => montarZip(leia(), { zip64Local: true, extraComum: true })],
  ['0xFFFFFFFF no cabeçalho local sem o campo extra Zip64 (montado à mão)', () => semTamanhoNoLocal(montarZip(leia()))],
  ['0xFFFFFFFF só no tamanho comprimido', () => {
    const b = Buffer.from(montarZip(leia()));
    b.writeUInt32LE(0xffffffff, 18);
    return b;
  }],
];

/** Zip64 que o clamd le (medido no 1.5.4): segue o veredito dele. */
const LIDAS: [string, OpcoesZipDeTeste][] = [
  ['0xFFFFFFFF no cabeçalho local com descritor de dados (Info-ZIP por pipe)', { zip64Local: true, descritor: true }],
  ['tamanhos reais no cabeçalho local com o campo extra 0x0001 (NetBeans)', { zip64TamanhosReais: true }],
  ['Zip64 só no diretório central e no registro de fim Zip64', { zip64Central: true, fim64: true }],
  ['Zip64 só no diretório central', { zip64Central: true }],
  ['só o registro de fim Zip64 + localizador', { fim64: true }],
];

describe('detector de Zip64: a forma que o clamd não lê é detectada', () => {
  for (const [nome, montar] of NAO_LIDAS) {
    it(nome, async () => {
      assert.deepEqual(await detectar(montar()), COM_ZIP64);
    });
  }

  it('docx Zip64 nessa forma (o container de docx/xlsx/jar/apk/odt é zip)', async () => {
    const docx = montarZip([
      { nome: '[Content_Types].xml', dados: texto('<Types/>') },
      { nome: 'word/document.xml', dados: MARCADOR_TESTE },
    ], { zip64Local: true });
    assert.deepEqual(await detectar(docx), COM_ZIP64);
  });

  it('depois de outro conteúdo (executável autoextraível, zip colado no fim)', async () => {
    const sfx = Buffer.concat([aleatorio(300_000), montarZip(leia(), { zip64Local: true })]);
    assert.deepEqual(await detectar(sfx), COM_ZIP64);
  });

  it('só na última entrada de um arquivo grande (vários blocos antes)', async () => {
    const grande = montarZip([
      { nome: 'dados.bin', dados: aleatorio(3 * 1024 * 1024), metodo: 'guardado' },
      { nome: 'ultimo.txt', dados: MARCADOR_TESTE },
    ]);
    const ultimo = 30 + 'dados.bin'.length + 3 * 1024 * 1024;
    assert.deepEqual(await detectar(grande), SEM_ZIP64, 'controle: o mesmo zip, comum');
    assert.deepEqual(await detectar(semTamanhoNoLocal(grande, ultimo)), COM_ZIP64);
  });
});

describe('detector de Zip64: as formas que o clamd lê não contam (seguem o veredito dele)', () => {
  for (const [nome, o] of LIDAS) {
    it(nome, async () => {
      assert.deepEqual(await detectar(montarZip(leia(), o)), SEM_ZIP64);
    });
  }

  it('docx com Zip64 na forma do NetBeans e na do Info-ZIP por pipe', async () => {
    const entradas = [
      { nome: '[Content_Types].xml', dados: texto('<Types/>') },
      { nome: 'word/document.xml', dados: MARCADOR_TESTE },
    ];
    assert.deepEqual(await detectar(montarZip(entradas, { zip64TamanhosReais: true })), SEM_ZIP64);
    assert.deepEqual(await detectar(montarZip(entradas, { zip64Local: true, descritor: true })), SEM_ZIP64);
  });
});

describe('detector de Zip64: zip dentro de zip', () => {
  for (const [nome, montar] of NAO_LIDAS) {
    it(`a forma não lida (${nome}) comprimida dentro de zip comum`, async () => {
      const externo = montarZip([{ nome: 'interno.zip', dados: montar() }]);
      assert.deepEqual(await detectar(externo), COM_ZIP64);
    });
  }

  for (const [nome, o] of LIDAS) {
    it(`forma lida (${nome}) dentro de zip comum: sem alarme`, async () => {
      const externo = montarZip([{ nome: 'interno.zip', dados: montarZip(leia(), o) }]);
      assert.deepEqual(await detectar(externo), SEM_ZIP64);
    });
  }

  it('a forma não lida guardada (sem compressão) dentro de zip comum', async () => {
    const externo = montarZip([{ nome: 'interno.zip', dados: montarZip(leia(), { zip64Local: true }), metodo: 'guardado' }]);
    assert.deepEqual(await detectar(externo), COM_ZIP64);
  });

  it('a forma não lida dentro de um Zip64 que o clamd lê (Info-ZIP por pipe e NetBeans)', async () => {
    const interno = montarZip(leia(), { zip64Local: true });
    for (const o of [{ zip64Local: true, descritor: true }, { zip64TamanhosReais: true }] as OpcoesZipDeTeste[]) {
      assert.deepEqual(await detectar(montarZip([{ nome: 'interno.zip', dados: interno }], o)), COM_ZIP64, JSON.stringify(o));
    }
  });

  it('três níveis abaixo, todos comprimidos, depois de outras entradas', async () => {
    let atual = montarZip(leia(), { zip64Local: true });
    for (let nivel = 0; nivel < 3; nivel++) {
      atual = montarZip([
        { nome: `antes-${nivel}.txt`, dados: texto('conteúdo comum '.repeat(1000)) },
        { nome: `nivel-${nivel}.zip`, dados: atual },
      ], nivel === 1 ? { descritor: true } : nivel === 2 ? { zip64Central: true, fim64: true } : {});
    }
    assert.deepEqual(await detectar(atual, 1000), COM_ZIP64);
  });

  it('entrada deflate corrompida antes não esconde a entrada seguinte', async () => {
    const quebrado = montarZip([
      { nome: 'quebrado.bin', dados: aleatorio(5000) },
      { nome: 'interno.zip', dados: montarZip(leia(), { zip64Local: true }) },
    ]);
    // Estraga os dados comprimidos da primeira entrada (o cabecalho continua valido).
    const inicioDados = 30 + 'quebrado.bin'.length;
    aleatorio(2000, 7).copy(quebrado, inicioDados);
    assert.deepEqual(await detectar(quebrado, 777), COM_ZIP64);
  });

  it('arquivo cortado no meio de uma entrada comprimida não derruba a busca', async () => {
    const externo = montarZip([{ nome: 'grande.txt', dados: texto('linha comum\n'.repeat(50_000)) }]);
    assert.deepEqual(await detectar(externo.subarray(0, Math.floor(externo.length / 2)), 1000), SEM_ZIP64);
  });
});

describe('detector de Zip64: cabeçalho atravessando a fronteira entre blocos', () => {
  for (const [nome, montar] of NAO_LIDAS) {
    it(`${nome}: todo ponto de corte em dois blocos`, async () => {
      const zip = montar();
      for (let corte = 1; corte < zip.length; corte++) {
        assert.deepEqual(await detectarComCortes(zip, [corte]), COM_ZIP64, `corte em ${corte}`);
      }
    });
  }

  it('formas lidas: nenhum ponto de corte cria alarme', async () => {
    for (const [nome, o] of LIDAS) {
      const zip = montarZip(leia(), o);
      for (let corte = 1; corte < zip.length; corte++) {
        assert.deepEqual(await detectarComCortes(zip, [corte]), SEM_ZIP64, `${nome}, corte em ${corte}`);
      }
    }
  });

  it('blocos de 1, 2, 3 e 5 bytes, direto e dentro de zip comprimido', async () => {
    const direto = montarZip(leia(), { zip64Local: true });
    const aninhado = montarZip([{ nome: 'interno.zip', dados: direto }], { zip64Local: true, descritor: true });
    for (const tamanho of [1, 2, 3, 5]) {
      assert.deepEqual(await detectar(direto, tamanho), COM_ZIP64, `direto, blocos de ${tamanho}`);
      assert.deepEqual(await detectar(aninhado, tamanho), COM_ZIP64, `aninhado, blocos de ${tamanho}`);
    }
  });

  it('zip comum e Info-ZIP por pipe em blocos de 1 byte continuam sem alarme', async () => {
    assert.deepEqual(await detectar(montarZip(leia(), { descritor: true }), 1), SEM_ZIP64);
    assert.deepEqual(await detectar(montarZip(leia(), { zip64Local: true, descritor: true }), 1), SEM_ZIP64);
  });
});

describe('detector de Zip64: sem falso positivo em binário', () => {
  it('32 MiB de bytes aleatórios', async () => {
    assert.deepEqual(await detectar(aleatorio(32 * 1024 * 1024)), SEM_ZIP64);
  });

  it('assinaturas soltas no meio de bytes aleatórios (sem a estrutura em volta) não contam', async () => {
    const b = aleatorio(8 * 1024 * 1024, 99);
    const assinaturas = ['504b0304', '504b0102', '504b0606', '504b0607', '504b0506'].map((h) => Buffer.from(h, 'hex'));
    // 20 mil assinaturas a cada ~400 bytes, cada uma seguida de bytes aleatorios.
    for (let i = 0, p = 1000; p < b.length - 100; i++, p += 400) assinaturas[i % assinaturas.length].copy(b, p);
    assert.deepEqual(await detectar(b), SEM_ZIP64);
  });

  it('0xFFFFFFFF e o id 0x0001 fora de um cabeçalho local válido não contam', async () => {
    const b = Buffer.alloc(1024 * 1024, 0xff);
    // "PK 03 04" com metodo invalido (0xFFFF) seguido de 0xFF: nao e cabecalho.
    Buffer.from('504b0304', 'hex').copy(b, 5000);
    // Campo extra 0x0001 solto, sem cabecalho.
    Buffer.from('0100100000000000', 'hex').copy(b, 9000);
    assert.deepEqual(await detectar(b), SEM_ZIP64);
  });
});

describe('detector de Zip64: tetos (zip-bomba) viram verificação incompleta, nunca "sem Zip64"', () => {
  it('passou do limite de bytes descomprimidos', async () => {
    const bomba = montarZip([{ nome: 'zeros.bin', dados: Buffer.alloc(2 * 1024 * 1024) }]);
    assert.deepEqual(await detectar(bomba, 64 * 1024, { ...PADRAO, limiteDescompressao: 1024 * 1024 }), { zip64: false, incompleta: true });
  });

  it('passou da profundidade máxima', async () => {
    // Tres niveis de descompressao: n1.zip, n2.zip e o leia.txt comprimido dentro dele.
    const tres = montarZip([{ nome: 'n1.zip', dados: montarZip([{ nome: 'n2.zip', dados: montarZip(leia()) }]) }]);
    assert.deepEqual(await detectar(tres, 64 * 1024, { ...PADRAO, profundidadeMaxima: 2 }), { zip64: false, incompleta: true });
    assert.deepEqual(await detectar(tres, 64 * 1024, { ...PADRAO, profundidadeMaxima: 3 }), SEM_ZIP64);
  });

  it('Zip64 achado vale mais que o teto (zip64: true, incompleta: false)', async () => {
    const zip = montarZip([
      { nome: 'x.zip', dados: montarZip(leia(), { zip64Local: true }), metodo: 'guardado' },
      { nome: 'zeros.bin', dados: Buffer.alloc(2 * 1024 * 1024) },
    ]);
    assert.deepEqual(await detectar(zip, 64 * 1024, { ...PADRAO, limiteDescompressao: 1024 }), COM_ZIP64);
  });

  it('o detector não lança: depois de finalizar, observar e finalizar de novo não mudam nada', async () => {
    const d = new DetectorZip64(PADRAO);
    await d.observar(montarZip(leia(), { zip64Local: true }));
    assert.deepEqual(await d.finalizar(), COM_ZIP64);
    await d.observar(Buffer.from('mais bytes'));
    assert.deepEqual(await d.finalizar(), COM_ZIP64);
  });

  it('descartar no meio (análise interrompida) solta tudo sem lançar', async () => {
    const d = new DetectorZip64(PADRAO);
    const zip = montarZip([{ nome: 'grande.txt', dados: texto('abc'.repeat(100_000)) }]);
    await d.observar(zip.subarray(0, 2000));
    d.descartar();
    await d.observar(zip.subarray(2000));
    assert.deepEqual(await d.finalizar(), SEM_ZIP64);
  });
});

describe('veredito com Zip64 (DT27)', () => {
  const limpo = { resultado: 'LIMPO' as const, ameaca: null };

  it('clamd "OK" + Zip64 = AMEACA Baluarte.Zip64.NaoAnalisavel', () => {
    assert.deepEqual(vereditoComZip64(limpo, COM_ZIP64), { resultado: 'AMEACA', ameaca: AMEACA_ZIP64 });
    assert.equal(AMEACA_ZIP64, 'Baluarte.Zip64.NaoAnalisavel');
  });

  it('clamd "OK" + busca incompleta = AMEACA Baluarte.Zip64.VerificacaoIncompleta', () => {
    assert.deepEqual(vereditoComZip64(limpo, { zip64: false, incompleta: true }), { resultado: 'AMEACA', ameaca: AMEACA_ZIP64_INCOMPLETA });
  });

  it('clamd "OK" sem Zip64 continua limpo', () => {
    assert.deepEqual(vereditoComZip64(limpo, SEM_ZIP64), limpo);
  });

  it('detecção do clamd vale como veio, com ou sem Zip64', () => {
    const eicar = { resultado: 'AMEACA' as const, ameaca: 'Eicar-Test-Signature' };
    assert.deepEqual(vereditoComZip64(eicar, COM_ZIP64), eicar);
    const limite = { resultado: 'AMEACA' as const, ameaca: 'Heuristics.Limits.Exceeded.MaxScanSize' };
    assert.deepEqual(vereditoComZip64(limite, { zip64: false, incompleta: true }), limite);
  });

  it('a mensagem diz que o antivírus não lê essa variante, e nunca "limpo" ou "seguro"', () => {
    const msg = mensagemDoResultado(AMEACA_ZIP64);
    assert.equal(msg, `Ameaça encontrada: Baluarte.Zip64.NaoAnalisavel (${ROTULO_ZIP64})`);
    assert.match(msg, /variante de Zip64 que o antivírus não lê; tratado como ameaça por precaução/);
    assert.match(mensagemDoResultado(AMEACA_ZIP64_INCOMPLETA), new RegExp(ROTULO_ZIP64_INCOMPLETA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const m of [msg, mensagemDoResultado(AMEACA_ZIP64_INCOMPLETA)]) {
      assert.notEqual(m, MENSAGEM_LIMPO);
      assert.doesNotMatch(m, /seguro|nenhuma ameaça|regra própria|limites de análise do antivírus/i);
    }
  });

  it('não se confunde com regra própria nem com limite do clamd', () => {
    for (const nome of [AMEACA_ZIP64, AMEACA_ZIP64_INCOMPLETA]) {
      assert.equal(ehZip64(nome), true);
      assert.equal(ehRegraPropria(nome), false);
      assert.equal(ehLimiteExcedido(nome), false);
    }
    for (const nome of ['Heuristics.Limits.Exceeded.MaxScanSize', 'YARA.BaluarteMacroSuspeita.UNOFFICIAL', 'Baluarte.Zip64', null]) {
      assert.equal(ehZip64(nome), false, String(nome));
    }
  });
});
