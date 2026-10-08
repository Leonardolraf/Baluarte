// B12 — trilha de auditoria (RN-008): as acoes novas (criar ativo, iniciar varredura,
// mudar status de vulnerabilidade) e a consulta GET /auditoria (so Administrador), com
// filtros, paginacao no servidor e validacao da query. Banco isolado (ver helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let admin: string;
let analista: string;
let colaborador: string;

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

type Registro = { id: string; acao: string; detalhe: string | null; quando: string; usuario: { id: string; nome: string; email: string } | null };

async function consultar(query: string, token = admin) {
  const r = await chamar('GET', `/auditoria${query}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as { status: string; dados: Registro[]; resumo: { total: number; pagina: number; tamanho: number; acoes: string[] } };
}

describe('RN-008: ações novas registradas', () => {
  let ativoId: string;
  let scanId: string;

  it('cadastro de ativo grava CRIAR_ATIVO com host e tipo, autor = quem cadastrou', async () => {
    const r = await chamar('POST', '/assets', { token: analista, body: { nome: 'Servidor B12', tipo: 'Banco de Dados', host: '10.12.0.1' } });
    assert.equal(r.status, 201);
    ativoId = r.body.dados.id;
    const reg = await prisma.auditLog.findFirst({ where: { acao: 'CRIAR_ATIVO', detalhe: { contains: '10.12.0.1' } } });
    assert.ok(reg, 'esperava CRIAR_ATIVO');
    assert.equal(reg.usuarioId, 'u-001');
    assert.match(reg.detalhe!, /Banco de Dados/);
    assert.match(reg.detalhe!, new RegExp(ativoId));
  });

  it('cadastro recusado (duplicado) não grava', async () => {
    const r = await chamar('POST', '/assets', { token: analista, body: { nome: 'Dup', tipo: 'Servidor', host: '10.12.0.1' } });
    assert.equal(r.status, 409);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'CRIAR_ATIVO', detalhe: { contains: '10.12.0.1' } } }), 1);
  });

  it('início de varredura grava INICIAR_VARREDURA com o ativo e o id da varredura', async () => {
    const r = await chamar('POST', '/scans', { token: admin, body: { ativoId } });
    assert.equal(r.status, 201);
    scanId = r.body.dados.scanId;
    const reg = await prisma.auditLog.findFirst({ where: { acao: 'INICIAR_VARREDURA', detalhe: { contains: scanId } } });
    assert.ok(reg, 'esperava INICIAR_VARREDURA');
    assert.equal(reg.usuarioId, 'u-000');
    assert.match(reg.detalhe!, new RegExp(ativoId));
    assert.match(reg.detalhe!, /10\.12\.0\.1/);
    // Varredura recusada (RN-003) nao grava outra.
    esperaErro(await chamar('POST', '/scans', { token: admin, body: { ativoId } }), 409, 'VARREDURA_EM_ANDAMENTO');
    assert.equal(await prisma.auditLog.count({ where: { acao: 'INICIAR_VARREDURA', detalhe: { contains: ativoId } } }), 1);
  });

  it('mudança de status de vulnerabilidade grava ALTERAR_STATUS_VULNERABILIDADE com antigo → novo', async () => {
    // Conclui a varredura (o tempo e simulado recuando criadoEm) para nascerem os achados.
    await prisma.scan.update({ where: { id: scanId }, data: { criadoEm: new Date(Date.now() - 60_000) } });
    await chamar('GET', '/scans', { token: analista });
    const achado = await prisma.finding.findFirst({ where: { scanId } });
    assert.ok(achado, 'varredura concluída tem achados');
    const r = await chamar('PATCH', `/vulnerabilidades/${achado.id}`, { token: analista, body: { status: 'Em remediação' } });
    assert.equal(r.status, 200);
    const reg = await prisma.auditLog.findFirst({ where: { acao: 'ALTERAR_STATUS_VULNERABILIDADE', detalhe: { contains: achado.id } } });
    assert.ok(reg, 'esperava ALTERAR_STATUS_VULNERABILIDADE');
    assert.equal(reg.usuarioId, 'u-001');
    assert.match(reg.detalhe!, /Aberta → Em remediação/);
    // Repetir o mesmo status nao e mudanca: nao grava de novo.
    await chamar('PATCH', `/vulnerabilidades/${achado.id}`, { token: analista, body: { status: 'Em remediação' } });
    assert.equal(await prisma.auditLog.count({ where: { acao: 'ALTERAR_STATUS_VULNERABILIDADE', detalhe: { contains: achado.id } } }), 1);
    // Status invalido e recusado e nao grava.
    esperaErro(await chamar('PATCH', `/vulnerabilidades/${achado.id}`, { token: analista, body: { status: 'X' } }), 400, 'STATUS_INVALIDO');
    assert.equal(await prisma.auditLog.count({ where: { acao: 'ALTERAR_STATUS_VULNERABILIDADE' } }), 1);
  });

  it('login, logout e campanha continuam registrados', async () => {
    const acoes = (await prisma.auditLog.findMany({ select: { acao: true }, distinct: ['acao'] })).map((a) => a.acao);
    assert.ok(acoes.includes('LOGIN'));
    await chamar('POST', '/campaigns', { token: analista, body: { nome: 'B12', destinatario: 'colaborador@empresa.com', template: 'urgencia' } });
    const t = await login(ADMIN.email, ADMIN.senha);
    assert.equal((await chamar('POST', '/auth/logout', { token: t })).status, 200);
    const depois = (await prisma.auditLog.findMany({ select: { acao: true }, distinct: ['acao'] })).map((a) => a.acao);
    for (const a of ['LOGOUT', 'CRIAR_CAMPANHA', 'ENVIAR_CAMPANHA']) assert.ok(depois.includes(a), `esperava ${a}`);
    admin = await login(ADMIN.email, ADMIN.senha);
  });
});

describe('GET /auditoria: RBAC', () => {
  it('sem token: 401 TOKEN_AUSENTE', async () => {
    esperaErro(await chamar('GET', '/auditoria'), 401, 'TOKEN_AUSENTE');
  });
  it('token inválido: 401 TOKEN_INVALIDO', async () => {
    esperaErro(await chamar('GET', '/auditoria', { token: 'x.y.z' }), 401, 'TOKEN_INVALIDO');
  });
  it('Analista e Colaborador: 403 PERFIL_SEM_PERMISSAO', async () => {
    esperaErro(await chamar('GET', '/auditoria', { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/auditoria', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
  });
});

describe('GET /auditoria: consulta', () => {
  it('formato da resposta, mais recente primeiro, autor da relação', async () => {
    const r = await consultar('');
    assert.equal(r.status, 'sucesso');
    assert.equal(r.resumo.pagina, 1);
    assert.equal(r.resumo.tamanho, 20);
    assert.equal(r.resumo.total, await prisma.auditLog.count());
    assert.ok(r.dados.length > 0 && r.dados.length <= 20);
    const ts = r.dados.map((d) => Date.parse(d.quando));
    assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'ordem decrescente de data');
    const comAutor = r.dados.find((d) => d.usuario);
    assert.ok(comAutor);
    assert.deepEqual(Object.keys(comAutor.usuario!).sort(), ['email', 'id', 'nome']);
    assert.deepEqual(Object.keys(comAutor).sort(), ['acao', 'detalhe', 'id', 'quando', 'usuario']);
  });

  it('resumo.acoes lista as ações distintas, incluindo ações novas sem mudança de código', async () => {
    await prisma.auditLog.create({ data: { usuarioId: null, acao: 'ANALISAR_ARQUIVO', detalhe: 'teste.pdf' } });
    const r = await consultar('?acao=ANALISAR_ARQUIVO');
    assert.ok(r.resumo.acoes.includes('ANALISAR_ARQUIVO'));
    assert.ok(r.resumo.acoes.includes('CRIAR_ATIVO'));
    assert.deepEqual(r.resumo.acoes, [...r.resumo.acoes].sort());
    assert.equal(new Set(r.resumo.acoes).size, r.resumo.acoes.length);
    assert.equal(r.resumo.total, 1);
    assert.equal(r.dados[0].usuario, null, 'registro sem autor sai com usuario null');
  });

  it('autor excluído sai com usuario null (o AuditLog não tem FK)', async () => {
    await prisma.auditLog.create({ data: { usuarioId: 'id-que-nao-existe', acao: 'ACAO_ORFA' } });
    const r = await consultar('?acao=ACAO_ORFA');
    assert.equal(r.dados.length, 1);
    assert.equal(r.dados[0].usuario, null);
  });

  it('filtro por ação', async () => {
    const r = await consultar('?acao=CRIAR_ATIVO');
    assert.ok(r.dados.length >= 1);
    assert.ok(r.dados.every((d) => d.acao === 'CRIAR_ATIVO'));
    assert.equal(r.resumo.total, await prisma.auditLog.count({ where: { acao: 'CRIAR_ATIVO' } }));
  });

  it('filtro por usuarioId e por e-mail (sem diferenciar maiúsculas)', async () => {
    const porId = await consultar('?usuarioId=u-001&tamanho=100');
    assert.ok(porId.dados.length > 0);
    assert.ok(porId.dados.every((d) => d.usuario?.id === 'u-001'));
    const porEmail = await consultar('?email=ANALISTA@empresa.com&tamanho=100');
    assert.equal(porEmail.resumo.total, porId.resumo.total);
    assert.ok(porEmail.dados.every((d) => d.usuario?.email === 'analista@empresa.com'));
    assert.equal((await consultar('?email=ninguem@empresa.com')).resumo.total, 0);
    assert.equal((await consultar('?email=analista@empresa.com&usuarioId=u-000')).resumo.total, 0, 'id e e-mail de pessoas diferentes');
  });

  it('filtro por período (de/ate), com ate só no dia indo até o fim do dia', async () => {
    const antigo = await prisma.auditLog.create({ data: { acao: 'PERIODO_B12', timestamp: new Date('2026-01-10T15:00:00Z') } });
    await prisma.auditLog.create({ data: { acao: 'PERIODO_B12', timestamp: new Date('2026-03-01T10:00:00Z') } });
    let r = await consultar('?acao=PERIODO_B12&de=2026-01-01&ate=2026-01-10');
    assert.equal(r.resumo.total, 1);
    assert.equal(r.dados[0].id, antigo.id);
    r = await consultar('?acao=PERIODO_B12&de=2026-02-01T00:00:00Z');
    assert.equal(r.resumo.total, 1);
    r = await consultar('?acao=PERIODO_B12&ate=2026-01-10T14:59:59Z');
    assert.equal(r.resumo.total, 0);
    r = await consultar('?acao=PERIODO_B12&de=2026-01-10T12:00:00-03:00&ate=2026-12-31');
    assert.equal(r.resumo.total, 2);
  });

  it('paginação no servidor sem repetir nem pular registros', async () => {
    await prisma.auditLog.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({ acao: 'PAGINA_B12', detalhe: String(i), timestamp: new Date(Date.UTC(2026, 4, 1, 0, 0, i)) })),
    });
    const p1 = await consultar('?acao=PAGINA_B12&tamanho=3&pagina=1');
    const p2 = await consultar('?acao=PAGINA_B12&tamanho=3&pagina=2');
    const p3 = await consultar('?acao=PAGINA_B12&tamanho=3&pagina=3');
    const p4 = await consultar('?acao=PAGINA_B12&tamanho=3&pagina=4');
    assert.deepEqual([p1, p2, p3].map((p) => p.dados.length), [3, 3, 1]);
    assert.equal(p4.dados.length, 0);
    assert.equal(p1.resumo.total, 7);
    assert.deepEqual({ pagina: p2.resumo.pagina, tamanho: p2.resumo.tamanho }, { pagina: 2, tamanho: 3 });
    const detalhes = [...p1.dados, ...p2.dados, ...p3.dados].map((d) => d.detalhe);
    assert.deepEqual(detalhes, ['6', '5', '4', '3', '2', '1', '0']);
    assert.equal((await consultar('?tamanho=100')).dados.length, Math.min(100, await prisma.auditLog.count()));
  });

  it('parâmetro vazio conta como ausente', async () => {
    const r = await consultar('?acao=&email=&de=&ate=&pagina=&tamanho=');
    assert.equal(r.resumo.total, await prisma.auditLog.count());
  });
});

describe('GET /auditoria: parâmetros inválidos dão 400, nunca 500', () => {
  const casos: Array<[string, string]> = [
    ['?acao[$ne]=x', 'ACAO_INVALIDA'],
    ['?acao=a&acao=b', 'ACAO_INVALIDA'],
    [`?acao=${'A'.repeat(65)}`, 'ACAO_INVALIDA'],
    ['?usuarioId[$gt]=', 'USUARIO_INVALIDO'],
    ['?email=nao-e-email', 'EMAIL_INVALIDO'],
    ['?email[$ne]=x', 'EMAIL_INVALIDO'],
    ['?de=ontem', 'DATA_INVALIDA'],
    ['?de=2026-02-30', 'DATA_INVALIDA'],
    ['?ate=2026-13-01', 'DATA_INVALIDA'],
    ['?ate=2026-01-01T25:00:00Z', 'DATA_INVALIDA'],
    ['?de[]=2026-01-01', 'DATA_INVALIDA'],
    ['?de=2026-05-02&ate=2026-05-01', 'PERIODO_INVALIDO'],
    ['?pagina=0', 'PAGINA_INVALIDA'],
    ['?pagina=-1', 'PAGINA_INVALIDA'],
    ['?pagina=1.5', 'PAGINA_INVALIDA'],
    ['?pagina=abc', 'PAGINA_INVALIDA'],
    ['?pagina=99999999999', 'PAGINA_INVALIDA'],
    ['?tamanho=0', 'TAMANHO_INVALIDO'],
    ['?tamanho=101', 'TAMANHO_INVALIDO'],
    ['?tamanho[$gt]=1', 'TAMANHO_INVALIDO'],
  ];
  for (const [query, codigo] of casos) {
    it(`${query} → 400 ${codigo}`, async () => {
      esperaErro(await chamar('GET', `/auditoria${query}`, { token: admin }), 400, codigo);
    });
  }
});
