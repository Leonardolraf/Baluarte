// B21 — ciclo de vida da varredura simulada (EM_FILA -> EM_ANDAMENTO -> CONCLUIDA) e
// RN-003 (uma varredura por vez no mesmo ativo). O tempo e simulado recuando `criadoEm`
// no banco, sem dormir. Banco Postgres isolado (baluarte_test_varredura) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ANALISTA, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/http/app.js');
const { prisma } = await import('../src/platform/db.js');
const { dadosAchado } = await import('../src/modules/scanner/catalogo.js');
const { statusPorTempo, DURACAO_VARREDURA_MS, TEMPO_EM_FILA_MS } = await import('../src/modules/scanner/ciclo.js');

let analista: string;
let hostSeq = 0;

before(async () => {
  await iniciarServidor(app);
  analista = await login(ANALISTA.email, ANALISTA.senha);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Ativo novo (e ativo) para cada teste nao depender dos outros. */
async function novoAtivo(): Promise<{ id: string; host: string }> {
  hostSeq += 1;
  const host = `10.21.0.${hostSeq}`;
  const r = await chamar('POST', '/assets', { token: analista, body: { nome: `Ativo B21 ${hostSeq}`, tipo: 'Servidor', host } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.dados.id as string, host };
}

async function iniciar(ativoId: string): Promise<string> {
  const r = await chamar('POST', '/scans', { token: analista, body: { ativoId } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.dados.statusVarredura, 'EM_FILA', 'contrato N2 AT1');
  return r.body.dados.scanId as string;
}

/** Simula a passagem do tempo: a varredura passa a ter sido criada `ms` atras. */
async function recuar(scanId: string, ms: number): Promise<Date> {
  const criadoEm = new Date(Date.now() - ms);
  await prisma.scan.update({ where: { id: scanId }, data: { criadoEm } });
  return criadoEm;
}

async function lerScan(scanId: string) {
  const r = await chamar('GET', '/scans', { token: analista });
  assert.equal(r.status, 200);
  const scan = (r.body.dados as Array<{ id: string; status: string; concluidoEm: string | null; _count: { findings: number } }>).find(
    (s) => s.id === scanId,
  );
  assert.ok(scan, 'varredura listada em GET /scans');
  return scan;
}

describe('status da varredura pelo tempo decorrido', () => {
  it('statusPorTempo respeita os limites de fila e de duração', () => {
    const t0 = new Date('2026-10-07T12:00:00Z');
    const em = (ms: number) => new Date(t0.getTime() + ms);
    assert.equal(statusPorTempo(t0, t0), 'EM_FILA');
    assert.equal(statusPorTempo(t0, em(TEMPO_EM_FILA_MS - 1)), 'EM_FILA');
    assert.equal(statusPorTempo(t0, em(TEMPO_EM_FILA_MS)), 'EM_ANDAMENTO');
    assert.equal(statusPorTempo(t0, em(DURACAO_VARREDURA_MS - 1)), 'EM_ANDAMENTO');
    assert.equal(statusPorTempo(t0, em(DURACAO_VARREDURA_MS)), 'CONCLUIDA');
  });

  it('nasce EM_FILA, sem achados e sem data de conclusão', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    const scan = await lerScan(scanId);
    assert.equal(scan.status, 'EM_FILA');
    assert.equal(scan.concluidoEm, null);
    assert.equal(scan._count.findings, 0);
    const vulns = await chamar('GET', `/vulnerabilidades?q=${ativo.host}`, { token: analista });
    assert.equal(vulns.body.resumo.total, 0, 'varredura em fila não expõe achados');
  });

  it('passa a EM_ANDAMENTO depois da fila, ainda sem achados', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    await recuar(scanId, TEMPO_EM_FILA_MS + 1_000);
    const scan = await lerScan(scanId);
    assert.equal(scan.status, 'EM_ANDAMENTO');
    assert.equal(scan.concluidoEm, null);
    assert.equal(scan._count.findings, 0);
    // A transicao fica gravada no banco, nao so na resposta.
    assert.equal((await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).status, 'EM_ANDAMENTO');
  });

  it('conclui depois da duração: grava concluidoEm (criação + duração) e gera os achados', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    await recuar(scanId, TEMPO_EM_FILA_MS + 1_000);
    await lerScan(scanId); // passa por EM_ANDAMENTO
    const criadoEm = await recuar(scanId, DURACAO_VARREDURA_MS + 5_000);

    const scan = await lerScan(scanId);
    assert.equal(scan.status, 'CONCLUIDA');
    assert.equal(new Date(scan.concluidoEm!).getTime(), criadoEm.getTime() + DURACAO_VARREDURA_MS);
    assert.ok(scan._count.findings >= 2 && scan._count.findings <= 4, `achados: ${scan._count.findings}`);

    const vulns = await chamar('GET', `/vulnerabilidades?q=${ativo.host}`, { token: analista });
    assert.equal(vulns.body.resumo.total, scan._count.findings, 'os achados aparecem na lista de vulnerabilidades');
  });

  it('vai direto de EM_FILA a CONCLUIDA se ninguém leu no meio, e o dashboard é quem percebe', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    const antes = (await chamar('GET', '/dashboard', { token: analista })).body.dados.kpis.vulnerabilidadesAbertas as number;
    await recuar(scanId, 60_000);

    const depois = (await chamar('GET', '/dashboard', { token: analista })).body.dados.kpis.vulnerabilidadesAbertas as number;
    const gravado = await prisma.scan.findUniqueOrThrow({ where: { id: scanId }, include: { _count: { select: { findings: true } } } });
    assert.equal(gravado.status, 'CONCLUIDA');
    assert.equal(depois - antes, gravado._count.findings, 'os achados passam a contar no dashboard só na conclusão');
  });

  it('leituras repetidas e simultâneas não duplicam os achados', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    await recuar(scanId, 60_000);
    const respostas = await Promise.all([
      chamar('GET', '/scans', { token: analista }),
      chamar('GET', '/dashboard', { token: analista }),
      chamar('GET', '/vulnerabilidades', { token: analista }),
      chamar('GET', '/scans', { token: analista }),
    ]);
    assert.ok(respostas.every((r) => r.status === 200));
    const qtd = await prisma.finding.count({ where: { scanId } });
    assert.ok(qtd >= 2 && qtd <= 4, `achados: ${qtd}`);
    await lerScan(scanId);
    assert.equal(await prisma.finding.count({ where: { scanId } }), qtd);
  });

  it('varredura antiga que já tinha achados conclui sem ganhar achados novos', async () => {
    const ativo = await novoAtivo();
    const scan = await prisma.scan.create({ data: { assetId: ativo.id, criadoEm: new Date(Date.now() - 60_000) } });
    await prisma.finding.create({ data: { ...dadosAchado('injecao-sql'), scanId: scan.id } });
    const lido = await lerScan(scan.id);
    assert.equal(lido.status, 'CONCLUIDA');
    assert.equal(lido._count.findings, 1);
  });
});

describe('RN-003: uma varredura por vez no mesmo ativo', () => {
  it('recusa nova varredura enquanto a anterior está em fila ou em andamento; libera depois de concluída', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);

    esperaErro(await chamar('POST', '/scans', { token: analista, body: { ativoId: ativo.id } }), 409, 'VARREDURA_EM_ANDAMENTO');
    await recuar(scanId, TEMPO_EM_FILA_MS + 1_000);
    const r = await chamar('POST', '/scans', { token: analista, body: { ativoId: ativo.id } });
    esperaErro(r, 409, 'VARREDURA_EM_ANDAMENTO');
    assert.equal(r.body.mensagem, 'Já existe uma varredura em andamento para este ativo');

    // Concluida pelo tempo, mesmo sem nenhuma leitura no meio: a criacao avanca o status antes de checar.
    await recuar(scanId, DURACAO_VARREDURA_MS + 1_000);
    await iniciar(ativo.id);
    assert.equal(await prisma.scan.count({ where: { assetId: ativo.id } }), 2);
  });

  it('não bloqueia varredura de outro ativo', async () => {
    const a = await novoAtivo();
    const b = await novoAtivo();
    await iniciar(a.id);
    await iniciar(b.id);
  });

  it('pedidos simultâneos no mesmo ativo criam uma única varredura', async () => {
    const ativo = await novoAtivo();
    const respostas = await Promise.all(
      Array.from({ length: 4 }, () => chamar('POST', '/scans', { token: analista, body: { ativoId: ativo.id } })),
    );
    assert.equal(respostas.filter((r) => r.status === 201).length, 1);
    for (const r of respostas.filter((x) => x.status !== 201)) esperaErro(r, 409, 'VARREDURA_EM_ANDAMENTO');
    assert.equal(await prisma.scan.count({ where: { assetId: ativo.id } }), 1);
  });

  it('as validações do contrato vêm antes do bloqueio', async () => {
    esperaErro(await chamar('POST', '/scans', { token: analista, body: {} }), 400, 'ATIVO_OBRIGATORIO');
    esperaErro(await chamar('POST', '/scans', { token: analista, body: { ativoId: 'ativo-999' } }), 404, 'ATIVO_NAO_ENCONTRADO');
    esperaErro(await chamar('POST', '/scans', { token: analista, body: { ativoId: 'ativo-002' } }), 422, 'ATIVO_INATIVO');
  });
});
