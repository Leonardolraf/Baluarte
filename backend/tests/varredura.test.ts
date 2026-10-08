// B21 — ciclo de vida da varredura simulada (EM_FILA -> EM_ANDAMENTO -> CONCLUIDA) e
// RN-003 (uma varredura por vez no mesmo ativo). B26 — progresso consultavel (percentual,
// etapa e estimativa nas leituras; GET /scans/:id) e avanco "em segundo plano" na leitura. O tempo e simulado recuando `criadoEm`
// no banco, sem dormir. Banco Postgres isolado (baluarte_test_varredura) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN,
  ANALISTA,
  SENHA_CONTA,
  chamar,
  criarUsuario,
  encerrarServidor,
  esperaErro,
  iniciarServidor,
  login,
  prepararBanco,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');
const { statusPorTempo, DURACAO_VARREDURA_MS, TEMPO_EM_FILA_MS, ETAPAS_ANDAMENTO } = await import(
  '../src/services/cicloVarredura.service.js'
);

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

type ScanLido = {
  id: string;
  status: string;
  criadoEm: string;
  concluidoEm: string | null;
  progresso: number;
  etapa: string;
  estimativaConclusao: string;
  asset: { host: string };
  _count: { findings: number };
};

describe('B26: progresso consultável', () => {
  let colaborador: string;
  before(async () => {
    const admin = await login(ADMIN.email, ADMIN.senha);
    const conta = await criarUsuario(admin, 'Colaborador', 'b26');
    colaborador = await login(conta.email, SENHA_CONTA);
  });

  async function detalhe(scanId: string): Promise<ScanLido> {
    const r = await chamar('GET', `/scans/${scanId}`, { token: analista });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'sucesso');
    return r.body.dados as ScanLido;
  }

  const lerComProgresso = async (scanId: string) => (await lerScan(scanId)) as unknown as ScanLido;

  it('POST /scans continua com a resposta do contrato (sem os campos novos)', async () => {
    const ativo = await novoAtivo();
    const r = await chamar('POST', '/scans', { token: analista, body: { ativoId: ativo.id } });
    assert.equal(r.status, 201);
    assert.equal(r.body.mensagem, 'Varredura enfileirada com sucesso');
    assert.deepEqual(Object.keys(r.body.dados).sort(), ['ativoId', 'criadoEm', 'scanId', 'statusVarredura']);
    assert.equal(r.body.dados.statusVarredura, 'EM_FILA');
  });

  it('GET /scans traz progresso, etapa e estimativa coerentes com o status em cada fase', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);

    const fila = await lerComProgresso(scanId);
    assert.equal(fila.status, 'EM_FILA');
    assert.equal(fila.progresso, 0);
    assert.equal(fila.etapa, 'Na fila');
    assert.equal(new Date(fila.estimativaConclusao).getTime(), new Date(fila.criadoEm).getTime() + DURACAO_VARREDURA_MS);

    // Meio do andamento (com folga para o tempo que o teste leva).
    const meio = TEMPO_EM_FILA_MS + (DURACAO_VARREDURA_MS - TEMPO_EM_FILA_MS) / 2;
    const criadoEm = await recuar(scanId, meio);
    const andamento = await lerComProgresso(scanId);
    assert.equal(andamento.status, 'EM_ANDAMENTO');
    assert.ok(andamento.progresso >= 50 && andamento.progresso <= 60, `progresso: ${andamento.progresso}`);
    assert.ok((ETAPAS_ANDAMENTO as readonly string[]).includes(andamento.etapa), andamento.etapa);
    assert.equal(new Date(andamento.estimativaConclusao).getTime(), criadoEm.getTime() + DURACAO_VARREDURA_MS);
    assert.equal(andamento._count.findings, 0);

    await recuar(scanId, DURACAO_VARREDURA_MS + 1_000);
    const concluida = await lerComProgresso(scanId);
    assert.equal(concluida.status, 'CONCLUIDA');
    assert.equal(concluida.progresso, 100);
    assert.equal(concluida.etapa, 'Concluída');
    assert.equal(concluida.estimativaConclusao, concluida.concluidoEm, 'concluída: a estimativa é a data real');
    assert.ok(concluida._count.findings >= 2);
  });

  it('nada novo é gravado: o progresso não existe no banco, só na resposta', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    const gravado = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    assert.deepEqual(Object.keys(gravado).sort(), ['assetId', 'concluidoEm', 'criadoEm', 'id', 'status']);
  });

  it('GET /scans/:id devolve só a varredura, no mesmo formato da lista', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    await recuar(scanId, TEMPO_EM_FILA_MS + 2_000);
    const um = await detalhe(scanId);
    assert.equal(um.id, scanId);
    assert.equal(um.status, 'EM_ANDAMENTO');
    assert.equal(um.asset.host, ativo.host);
    assert.ok(um.progresso >= 1 && um.progresso <= 99);
    assert.equal(um.etapa, ETAPAS_ANDAMENTO[0]);
    const daLista = await lerComProgresso(scanId);
    assert.deepEqual(Object.keys(um).sort(), Object.keys(daLista).sort());
  });

  it('GET /scans/:id também avança: a varredura vencida conclui com achados na consulta dela', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    await recuar(scanId, 60_000);
    const um = await detalhe(scanId);
    assert.equal(um.status, 'CONCLUIDA');
    assert.equal(um.progresso, 100);
    assert.ok(um._count.findings >= 2 && um._count.findings <= 4);
  });

  it('a consulta de uma varredura avança as outras pendentes (segundo plano na leitura)', async () => {
    const a = await novoAtivo();
    const b = await novoAtivo();
    const idA = await iniciar(a.id);
    const idB = await iniciar(b.id);
    await recuar(idA, 60_000);
    await recuar(idB, 60_000);
    await detalhe(idA);
    const outra = await prisma.scan.findUniqueOrThrow({ where: { id: idB }, include: { _count: { select: { findings: true } } } });
    assert.equal(outra.status, 'CONCLUIDA');
    assert.ok(outra._count.findings >= 2);
  });

  it('o dashboard de qualquer perfil (até Colaborador) conclui as pendentes e os achados aparecem sem abrir /scans', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    await recuar(scanId, 60_000);
    const r = await chamar('GET', '/dashboard', { token: colaborador });
    assert.equal(r.status, 200);
    const gravado = await prisma.scan.findUniqueOrThrow({ where: { id: scanId }, include: { _count: { select: { findings: true } } } });
    assert.equal(gravado.status, 'CONCLUIDA');
    assert.ok(gravado._count.findings >= 2);
    const vulns = await chamar('GET', `/vulnerabilidades?q=${ativo.host}`, { token: analista });
    assert.equal(vulns.body.resumo.total, gravado._count.findings);
  });

  it('RBAC e erros de GET /scans/:id: 401 sem token, 403 Colaborador, 400 id inválido, 404 inexistente', async () => {
    const ativo = await novoAtivo();
    const scanId = await iniciar(ativo.id);
    esperaErro(await chamar('GET', `/scans/${scanId}`), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', `/scans/${scanId}`, { token: 'abc' }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', `/scans/${scanId}`, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    // A autenticacao e o perfil vem antes da validacao do id.
    esperaErro(await chamar('GET', '/scans/a.b'), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', '/scans/a.b', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    const invalidos = ['a.b', encodeURIComponent("1' OR '1'='1"), 'x'.repeat(65), encodeURIComponent('{"$ne":null}')];
    for (const id of invalidos) {
      esperaErro(await chamar('GET', `/scans/${id}`, { token: analista }), 400, 'VARREDURA_ID_INVALIDO');
    }
    const nao = await chamar('GET', '/scans/scan-que-nao-existe', { token: analista });
    esperaErro(nao, 404, 'VARREDURA_NAO_ENCONTRADA');
    assert.equal(nao.body.mensagem, 'Varredura não encontrada');
    // Administrador tambem opera a plataforma.
    const admin = await login(ADMIN.email, ADMIN.senha);
    assert.equal((await chamar('GET', `/scans/${scanId}`, { token: admin })).status, 200);
  });
});
