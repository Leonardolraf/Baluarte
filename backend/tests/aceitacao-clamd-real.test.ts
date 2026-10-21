// Teste de ACEITACAO contra o clamd REAL (Melhorias #18). So roda com CLAMAV_HOST definido; sem
// ele, o arquivo inteiro fica marcado como pulado e nem o banco e criado. Roteiro completo, com o
// comando para subir o clamd isolado e o resultado medido antes e depois: docs/CLAMD-LIMITES.md.
//
// O risco que este teste cobre: com o StreamMaxLength padrao, o clamd nao le a cauda de um
// arquivo grande. Aqui os arquivos sao SIMPLES (sem compactacao) e o marcador YARA inofensivo do
// Baluarte (antivirus/regras/baluarte_teste.yar) fica nos ULTIMOS bytes: so sai AMEACA se o clamd
// recebeu e varreu o arquivo inteiro. Qualquer outro desfecho (LIMPO, 503) reprova. O marcador e
// montado em memoria a partir de partes (nunca e gravado em disco inteiro, nem neste fonte), e o
// arquivo e gerado em fluxo (envioEmFluxo.ts): nada de 200 MB na memoria.
//
// Rodar (com o clamd do perfil antivirus no ar, regras do Baluarte carregadas):
//   CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=<porta> TEST_DB_PREFIXO=<prefixo>_ \
//     node --import tsx --test tests/aceitacao-clamd-real.test.ts
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, encerrarServidor, iniciarServidor, login, prepararBanco } from './helpers.js';
import { enviarArquivoEmFluxo } from './envioEmFluxo.js';

const comClamdReal = Boolean(process.env.CLAMAV_HOST);
const MB = 1024 * 1024;

/** O marcador de baluarte_teste.yar, montado em memoria. */
const MARCADOR = ['BALUARTE', 'TESTE', 'AMEACA', '0001', 'ARQUIVO', 'INOFENSIVO'].join('-');
const CAUDA = Buffer.from(`\n${MARCADOR}\n`, 'ascii');
const REGRA = 'YARA.BaluarteMarcadorTeste.UNOFFICIAL';

describe('aceitação contra o clamd real: marcador nos últimos bytes de arquivo grande', { skip: comClamdReal ? false : 'sem CLAMAV_HOST (clamd real)' }, () => {
  let admin = '';
  let encerrar: (() => Promise<void>) | null = null;

  before(async () => {
    prepararBanco(import.meta.url);
    const { app } = await import('../src/app.js');
    const { prisma } = await import('../src/config/db.js');
    await iniciarServidor(app);
    admin = await login(ADMIN.email, ADMIN.senha);
    encerrar = async () => {
      await encerrarServidor();
      await prisma.$disconnect();
    };
  });

  after(async () => {
    await encerrar?.();
  });

  async function enviar(tamanho: number, cauda?: Buffer) {
    const inicio = Date.now();
    const r = await enviarArquivoEmFluxo({ token: admin, tamanho, nome: `aceitacao-${tamanho / MB}mb.txt`, cauda });
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    // Linha de registro para o roteiro (docs/CLAMD-LIMITES.md): o desfecho real, aprovado ou nao.
    console.log(`[aceitacao-clamd] ${tamanho / MB} MB ${cauda ? 'marcador no fim' : 'sem marcador'}: ` +
      `HTTP ${r.status} ${r.body?.dados?.resultado ?? r.body?.codigoErro ?? '?'} ${r.body?.dados?.ameaca ?? ''} (${segundos} s)`);
    return r;
  }

  it('controle: 30 MB sem o marcador saem LIMPO (o AMEAÇA abaixo vem do marcador, não do preenchimento)', async () => {
    const r = await enviar(30 * MB);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.resultado, 'LIMPO');
  });

  for (const tamanho of [30 * MB, 200 * MB]) {
    it(`${tamanho / MB} MB com o marcador nos últimos bytes: AMEAÇA ${REGRA}`, async () => {
      const r = await enviar(tamanho, CAUDA);
      assert.equal(r.status, 201, `o clamd precisa ler o arquivo inteiro: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.dados.tamanho, tamanho);
      assert.equal(r.body.dados.resultado, 'AMEACA', 'cauda não lida sairia LIMPO');
      assert.equal(r.body.dados.ameaca, REGRA);
    });
  }
});
