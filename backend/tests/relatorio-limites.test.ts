// DT36 — limites da exportacao do relatorio de vulnerabilidades (PDF e Excel), pela rota:
// - teto de achados por exportacao: contado com o mesmo filtro ANTES de carregar os achados;
//   acima dele, 422 RELATORIO_GRANDE_DEMAIS com mensagem que manda filtrar, e a tentativa vai
//   para a auditoria (acao EXPORTAR_RELATORIO_VULNERABILIDADES_RECUSADA);
// - uma exportacao por vez: a segunda simultanea leva 429 EXPORTACAO_EM_ANDAMENTO (tambem
//   auditada) e a vaga volta em todo desfecho (sucesso, erro, conexao que caiu).
// O teto menor vem de RELATORIO_TETO_ACHADOS (que so baixa a constante); o ultimo teste semeia
// acima da constante de producao (50.000) para provar o numero de verdade.
// O desenho e trocado por `mock.method(DESENHAR, ...)` para segurar uma exportacao no meio (a
// concorrencia fica deterministica) ou para fazer o desenho falhar.
// Banco Postgres isolado (baluarte_test_relatorio_limites) — ver helpers.ts.
import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ANALISTA, baixar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, urlBase } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');
const { ACAO_EXPORTACAO_RECUSADA, TETO_ACHADOS_RELATORIO } = await import('../src/models/vulnerabilidade.model.js');
const { DESENHAR } = await import('../src/services/vulnerabilidade.service.js');

const ACAO_SUCESSO = 'EXPORTAR_RELATORIO_VULNERABILIDADES';
const FORMATOS = [
  { formato: 'PDF', rota: '/vulnerabilidades/relatorio.pdf', outra: '/vulnerabilidades/relatorio.xlsx' },
  { formato: 'XLSX', rota: '/vulnerabilidades/relatorio.xlsx', outra: '/vulnerabilidades/relatorio.pdf' },
] as const;

let analista: string;
let ativo = '';
let scanId = '';

before(async () => {
  await iniciarServidor(app);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  // Ativo proprio: os testes filtram por ele, entao os achados do seed nao entram na conta.
  ativo = (await prisma.asset.create({ data: { nome: 'Portal de Limites', host: '10.36.0.1', tipo: 'Aplicacao' } })).id;
  scanId = (await prisma.scan.create({ data: { assetId: ativo, status: 'CONCLUIDA', concluidoEm: new Date() } })).id;
  await prisma.finding.createMany({
    data: [
      { ...dadosAchado('injecao-sql'), scanId, status: 'Aberta' },
      { ...dadosAchado('componente-vulneravel'), scanId, status: 'Aberta' },
      { ...dadosAchado('controle-acesso'), scanId, status: 'Em revisão' },
      { ...dadosAchado('cors-curinga'), scanId, status: 'Aberta' },
      { ...dadosAchado('idor'), scanId, status: 'Aberta' },
    ],
  });
});
afterEach(() => {
  mock.restoreAll();
  delete process.env.RELATORIO_TETO_ACHADOS;
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

const doAtivo = () => `?ativoId=${ativo}`;
const contar = (acao: string) => prisma.auditLog.count({ where: { acao } });
const ultima = (acao: string) => prisma.auditLog.findFirst({ where: { acao }, orderBy: { sequencia: 'desc' } });

/** Um sinal que o teste espera e uma porta que o teste abre. */
function porta() {
  let abrir!: () => void;
  const aberta = new Promise<void>((r) => (abrir = r));
  return { aberta, abrir };
}

/**
 * Troca o desenho do formato por um que avisa quando comecou e so termina quando o teste abrir a
 * porta; `terminou` resolve depois que o desenho original devolveu o arquivo.
 */
function segurarDesenho(formato: 'PDF' | 'XLSX') {
  const original = DESENHAR[formato];
  const comecou = porta();
  const liberar = porta();
  const terminou = porta();
  mock.method(DESENHAR, formato, async (relatorio: Parameters<typeof original>[0]) => {
    comecou.abrir();
    await liberar.aberta;
    try {
      return await original(relatorio);
    } finally {
      terminou.abrir();
    }
  });
  return { comecou: comecou.aberta, liberar: liberar.abrir, terminou: terminou.aberta };
}

describe('teto de achados por exportação (PDF e XLSX)', () => {
  for (const { formato, rota } of FORMATOS) {
    it(`${formato}: acima do teto é 422 RELATORIO_GRANDE_DEMAIS com o total, e a tentativa é auditada`, async () => {
      process.env.RELATORIO_TETO_ACHADOS = '3';
      const sucessos = await contar(ACAO_SUCESSO);
      const r = await baixar(`${rota}${doAtivo()}`, analista);
      esperaErro(r, 422, 'RELATORIO_GRANDE_DEMAIS');
      assert.equal(
        r.body.mensagem,
        'O relatório teria 5 achados (máximo 3). Filtre por severidade, status ou ativo para gerar um relatório menor.',
      );
      assert.ok(!r.headers.get('content-disposition'), 'nenhum arquivo');
      assert.equal(await contar(ACAO_SUCESSO), sucessos, 'recusa não conta como exportação');
      const reg = await ultima(ACAO_EXPORTACAO_RECUSADA);
      assert.equal(
        reg?.detalhe,
        `motivo: RELATORIO_GRANDE_DEMAIS; 5 achados (máximo 3); severidade: todas; status: todos; busca: nenhuma; ativo: Portal de Limites (10.36.0.1) [${ativo}]; formato: ${formato}`,
      );
      assert.ok(reg?.usuarioId, 'a tentativa tem autor');
    });

    it(`${formato}: no teto exato passa, e filtrar para baixo do teto também`, async () => {
      process.env.RELATORIO_TETO_ACHADOS = '5';
      assert.equal((await baixar(`${rota}${doAtivo()}`, analista)).status, 200, 'exatamente no teto');
      process.env.RELATORIO_TETO_ACHADOS = '4';
      esperaErro(await baixar(`${rota}${doAtivo()}`, analista), 422, 'RELATORIO_GRANDE_DEMAIS');
      const filtrado = await baixar(`${rota}${doAtivo()}&status=Aberta&severidade=Cr%C3%ADtico`, analista);
      assert.equal(filtrado.status, 200, 'filtrado fica abaixo do teto');
      assert.match((await ultima(ACAO_SUCESSO))!.detalhe ?? '', new RegExp(`formato: ${formato}$`));
    });
  }

  it('a contagem vem antes de carregar e desenhar: acima do teto, o desenho nem é chamado', async () => {
    process.env.RELATORIO_TETO_ACHADOS = '1';
    const pdf = mock.method(DESENHAR, 'PDF');
    const xlsx = mock.method(DESENHAR, 'XLSX');
    esperaErro(await baixar(`/vulnerabilidades/relatorio.pdf${doAtivo()}`, analista), 422, 'RELATORIO_GRANDE_DEMAIS');
    esperaErro(await baixar(`/vulnerabilidades/relatorio.xlsx${doAtivo()}`, analista), 422, 'RELATORIO_GRANDE_DEMAIS');
    assert.equal(pdf.mock.callCount() + xlsx.mock.callCount(), 0);
  });
});

describe('uma exportação por vez', () => {
  for (const { formato, rota, outra } of FORMATOS) {
    it(`${formato} em curso: a segunda simultânea (PDF e XLSX) leva 429 EXPORTACAO_EM_ANDAMENTO, auditada; a primeira termina 200`, async () => {
      const seguro = segurarDesenho(formato);
      const primeira = baixar(`${rota}${doAtivo()}`, analista);
      await seguro.comecou;
      const recusasAntes = await contar(ACAO_EXPORTACAO_RECUSADA);
      for (const segunda of [rota, outra]) {
        const r = await baixar(`${segunda}?severidade=Alto&ativoId=${ativo}`, analista);
        esperaErro(r, 429, 'EXPORTACAO_EM_ANDAMENTO');
        assert.equal(r.body.mensagem, 'Já há uma exportação de relatório em andamento. Tente de novo em instantes.');
      }
      assert.equal(await contar(ACAO_EXPORTACAO_RECUSADA), recusasAntes + 2);
      const outroFormato = formato === 'PDF' ? 'XLSX' : 'PDF';
      assert.equal(
        (await ultima(ACAO_EXPORTACAO_RECUSADA))?.detalhe,
        `motivo: EXPORTACAO_EM_ANDAMENTO; severidade: Alto; status: todos; busca: nenhuma; ativoId: [${ativo}]; formato: ${outroFormato}`,
      );
      seguro.liberar();
      const r1 = await primeira;
      assert.equal(r1.status, 200);
      // A vaga voltou: a proxima passa.
      assert.equal((await baixar(`${outra}${doAtivo()}`, analista)).status, 200);
    });
  }

  it('duas exportações disparadas juntas: uma passa e a outra recebe 429', async () => {
    const seguro = segurarDesenho('PDF');
    mock.method(DESENHAR, 'XLSX', (relatorio: Parameters<(typeof DESENHAR)['PDF']>[0]) => DESENHAR.PDF(relatorio));
    const pedidos = [
      baixar(`/vulnerabilidades/relatorio.pdf${doAtivo()}`, analista),
      baixar(`/vulnerabilidades/relatorio.xlsx${doAtivo()}`, analista),
    ];
    // A que pegou a vaga fica presa no desenho ate a OUTRA responder: sem o semaforo, as duas
    // ficariam presas e nenhuma responderia (o prazo abaixo falha o teste).
    const prazo = new Promise<never>((_, falha) => setTimeout(() => falha(new Error('nenhuma resposta: as duas entraram?')), 15_000).unref());
    const primeira = await Promise.race([Promise.race(pedidos), prazo]);
    esperaErro(primeira, 429, 'EXPORTACAO_EM_ANDAMENTO');
    seguro.liberar();
    const status = (await Promise.all(pedidos)).map((r) => r.status).sort();
    assert.deepEqual(status, [200, 429]);
  });

  it('a vaga volta depois de um erro interno no desenho (500), em PDF e XLSX', async () => {
    const erros = mock.method(console, 'error', () => {});
    for (const { formato, rota } of FORMATOS) {
      mock.method(DESENHAR, formato, async () => {
        throw new Error('falha simulada no desenho');
      });
      esperaErro(await baixar(`${rota}${doAtivo()}`, analista), 500, 'ERRO_INTERNO');
      mock.restoreAll();
      mock.method(console, 'error', () => {});
      assert.equal((await baixar(`${rota}${doAtivo()}`, analista)).status, 200, `${formato}: vaga liberada depois do 500`);
    }
    assert.ok(erros.mock.callCount() >= 1);
  });

  it('a vaga volta depois de um erro de regra (404 de ativo inexistente e 422 do teto)', async () => {
    esperaErro(await baixar('/vulnerabilidades/relatorio.pdf?ativoId=ativo-inexistente', analista), 404, 'ATIVO_NAO_ENCONTRADO');
    assert.equal((await baixar(`/vulnerabilidades/relatorio.pdf${doAtivo()}`, analista)).status, 200);
    process.env.RELATORIO_TETO_ACHADOS = '1';
    esperaErro(await baixar(`/vulnerabilidades/relatorio.xlsx${doAtivo()}`, analista), 422, 'RELATORIO_GRANDE_DEMAIS');
    delete process.env.RELATORIO_TETO_ACHADOS;
    assert.equal((await baixar(`/vulnerabilidades/relatorio.xlsx${doAtivo()}`, analista)).status, 200);
  });

  it('a vaga volta quando o cliente desiste no meio (conexão caída)', async () => {
    const seguro = segurarDesenho('XLSX');
    const cancelar = new AbortController();
    const pedido = fetch(`${urlBase()}/vulnerabilidades/relatorio.xlsx${doAtivo()}`, {
      headers: { Authorization: `Bearer ${analista}` },
      signal: cancelar.signal,
    }).catch((e: unknown) => e);
    await seguro.comecou;
    cancelar.abort();
    assert.ok((await pedido) instanceof Error, 'o cliente desistiu');
    // Enquanto a montagem segue (a memoria continua ocupada), a vaga segue ocupada.
    esperaErro(await baixar(`/vulnerabilidades/relatorio.pdf${doAtivo()}`, analista), 429, 'EXPORTACAO_EM_ANDAMENTO');
    seguro.liberar();
    await seguro.terminou;
    // O `finally` roda logo depois do desenho; da a volta no laco antes de pedir de novo.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await baixar(`/vulnerabilidades/relatorio.pdf${doAtivo()}`, analista)).status, 200);
  });
});

describe('teto de produção, sem variável', () => {
  it(`acima de ${TETO_ACHADOS_RELATORIO.toLocaleString('pt-BR')} achados de verdade: 422 nos dois formatos, sem carregar os achados`, async () => {
    // 50.001 achados num ativo proprio, em lotes (o Postgres aceita ate 65.535 parametros por instrucao).
    const grande = (await prisma.asset.create({ data: { nome: 'Parque Grande', host: '10.36.0.2', tipo: 'Aplicacao' } })).id;
    const scan = (await prisma.scan.create({ data: { assetId: grande, status: 'CONCLUIDA', concluidoEm: new Date() } })).id;
    const linha = { ...dadosAchado('cookie-inseguro'), scanId: scan, status: 'Aberta' };
    const total = TETO_ACHADOS_RELATORIO + 1;
    for (let feitos = 0; feitos < total; feitos += 2_000)
      await prisma.finding.createMany({ data: Array.from({ length: Math.min(2_000, total - feitos) }, () => linha) });
    const desenho = mock.method(DESENHAR, 'PDF');
    for (const { formato, rota } of FORMATOS) {
      const inicio = Date.now();
      const r = await baixar(`${rota}?ativoId=${grande}`, analista);
      esperaErro(r, 422, 'RELATORIO_GRANDE_DEMAIS');
      assert.equal(
        r.body.mensagem,
        'O relatório teria 50.001 achados (máximo 50.000). Filtre por severidade, status ou ativo para gerar um relatório menor.',
      );
      assert.ok(Date.now() - inicio < 10_000, `${formato}: a recusa sai da contagem, sem montar o relatório`);
      assert.match((await ultima(ACAO_EXPORTACAO_RECUSADA))?.detalhe ?? '', new RegExp(`50001 achados \\(máximo 50000\\).*formato: ${formato}$`));
    }
    assert.equal(desenho.mock.callCount(), 0);
  });
});
