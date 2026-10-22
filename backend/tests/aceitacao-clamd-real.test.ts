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
// DT26: no HTML (e na parte HTML de um e-mail) o ClamAV pula a varredura crua por padrao e as
// regras YARA so veem o HTML normalizado (minusculas, entidades decodificadas, comentarios
// apagados). O segundo bloco manda o marcador DENTRO de HTML (texto visivel, comentario, atributo,
// <script>, <style>, com entidades) e dentro de um e-mail com a parte HTML em base64: tudo AMEACA.
// O terceiro e o teste de COMPORTAMENTO do MaxHTMLNormalize (#18): um HTML de 45 MB, gerado em
// fluxo, com HTML smuggling que SO a forma normalizada mostra (atob escrito com entidade num
// atributo de evento), tem de sair AMEACA. Com a configuracao antiga (sem os CLAMD_CONF_*, padrao
// 40 MB) ele sai LIMPO: medido em 19/10/2026, docs/CLAMD-LIMITES.md, item 5.
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
const REGRA_SMUGGLING = 'YARA.BaluarteHtmlPayloadBase64.UNOFFICIAL';

/** Cada caractere como entidade numerica (&#66;&#65;...): so a forma normalizada tem o texto. */
const comEntidades = (texto: string) => [...texto].map((c) => `&#${c.charCodeAt(0)};`).join('');

/** Pagina HTML pequena com `trecho` no meio de paragrafos comuns. */
function pagina(trecho: string): Buffer {
  const comum = '<p>texto comum de controle.</p>\n'.repeat(200);
  return Buffer.from(`<!DOCTYPE html>\n<html><head><title>relatorio</title></head><body>\n${comum}${trecho}\n${comum}</body></html>\n`);
}

/** E-mail (.eml) com a parte HTML em base64, como a maioria dos clientes grava. */
function emailComHtml(trecho: string): Buffer {
  const corpo = pagina(trecho).toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(['From: ti@baluarte.test', 'To: pessoa@baluarte.test', 'Subject: relatorio', 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=us-ascii', 'Content-Transfer-Encoding: base64', '', corpo, ''].join('\r\n'));
}

/**
 * HTML smuggling inofensivo (base64 de texto comum) que SO a forma normalizada mostra: "atob(" vem
 * com o "o" em entidade, num atributo de evento (o navegador decodifica a entidade e executa). No
 * cru nao ha nenhuma das strings de remontagem da regra (atob( / new Blob / msSaveOrOpenBlob):
 * quem acha e a normalizacao do HTML, a que o MaxHTMLNormalize limita.
 */
const BASE64_INOFENSIVO = Buffer.from('conteudo inofensivo de teste do Baluarte. '.repeat(120)).toString('base64');
const SMUGGLING_SO_NORMALIZADO = Buffer.from(
  `<img src="x" onerror="var d=at&#111;b('${BASE64_INOFENSIVO}');">\n</body></html>\n`, 'ascii');
const CABECA_HTML = Buffer.from('<!DOCTYPE html>\n<html><head><title>relatorio</title></head><body>\n', 'ascii');
/** 1 MiB de paragrafos comuns (32 bytes cada), repetido em fluxo para montar o HTML grande. */
const BLOCO_HTML = Buffer.from('<p>texto comum de controle.</p>\n'.repeat((1024 * 1024) / 32), 'ascii');

describe('aceitação contra o clamd real', { skip: comClamdReal ? false : 'sem CLAMAV_HOST (clamd real)' }, () => {
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

  describe('marcador nos últimos bytes de arquivo grande (#18)', () => {
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

  /** Envia um arquivo pequeno ja montado (inteiro como "cauda" do envio em fluxo). */
  async function enviarPronto(nome: string, dados: Buffer) {
    const r = await enviarArquivoEmFluxo({ token: admin, tamanho: dados.length, nome, cauda: dados });
    console.log(`[aceitacao-clamd] ${nome}: HTTP ${r.status} ${r.body?.dados?.resultado ?? r.body?.codigoErro ?? '?'} ${r.body?.dados?.ameaca ?? ''}`);
    return r;
  }

  describe('marcador dentro de HTML e de e-mail com HTML (DT26)', () => {
    it('controle: a mesma página sem o marcador sai LIMPO', async () => {
      const r = await enviarPronto('controle.html', pagina('<p>nada de especial aqui</p>'));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.dados.resultado, 'LIMPO');
    });

    const casos: Array<[string, string, Buffer]> = [
      ['texto visível', 'visivel.html', pagina(`<p>${MARCADOR}</p>`)],
      ['comentário HTML (some da forma normalizada; só a varredura crua o vê)', 'comentario.html', pagina(`<!-- ${MARCADOR} -->`)],
      ['atributo', 'atributo.html', pagina(`<div title="${MARCADOR}">x</div>`)],
      ['<script>', 'script.html', pagina(`<script>var a = "${MARCADOR}";</script>`)],
      ['<style>', 'style.html', pagina(`<style>/* ${MARCADOR} */ p { color: red; }</style>`)],
      ['texto visível com entidades (só a forma normalizada o mostra)', 'entidades.html', pagina(`<p>${comEntidades(MARCADOR)}</p>`)],
      ['e-mail com a parte HTML em base64, texto visível', 'visivel.eml', emailComHtml(`<p>${MARCADOR}</p>`)],
      ['e-mail com a parte HTML em base64, comentário', 'comentario.eml', emailComHtml(`<!-- ${MARCADOR} -->`)],
    ];
    for (const [caso, nome, dados] of casos) {
      it(`marcador em ${caso}: AMEAÇA ${REGRA}`, async () => {
        const r = await enviarPronto(nome, dados);
        assert.equal(r.status, 201, JSON.stringify(r.body));
        assert.equal(r.body.dados.resultado, 'AMEACA', 'o YARA só via o HTML normalizado em minúsculas (DT26)');
        assert.equal(r.body.dados.ameaca, REGRA);
      });
    }
  });

  describe('MaxHTMLNormalize (#18): HTML de mais de 40 MB', () => {
    const tamanho = 45 * MB;

    it('a amostra depende da normalização: o cru não tem nenhuma string de remontagem da regra', () => {
      const cru = SMUGGLING_SO_NORMALIZADO.toString('ascii').toLowerCase();
      for (const s of ['atob(', 'new blob', 'mssaveoropenblob']) assert.ok(!cru.includes(s), s);
      assert.match(cru, /[a-z0-9+/]{2000}/i, 'bloco base64 de 2000+ caracteres');
    });

    it(`45 MB com HTML smuggling só visível normalizado, no fim: AMEAÇA ${REGRA_SMUGGLING}`, async () => {
      const inicio = Date.now();
      const r = await enviarArquivoEmFluxo({
        token: admin, tamanho, nome: 'grande-45mb.html', cabeca: CABECA_HTML, bloco: BLOCO_HTML, cauda: SMUGGLING_SO_NORMALIZADO,
      });
      console.log(`[aceitacao-clamd] HTML 45 MB, smuggling normalizado no fim: HTTP ${r.status} ` +
        `${r.body?.dados?.resultado ?? r.body?.codigoErro ?? '?'} ${r.body?.dados?.ameaca ?? ''} (${((Date.now() - inicio) / 1000).toFixed(1)} s)`);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.dados.tamanho, tamanho);
      assert.equal(r.body.dados.resultado, 'AMEACA', 'com o MaxHTMLNormalize padrão (40M) o HTML grande não é normalizado e sai LIMPO');
      assert.equal(r.body.dados.ameaca, REGRA_SMUGGLING);
    });
  });
});
