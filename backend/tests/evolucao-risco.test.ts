// B25b — evolucao do risco nos ultimos 30 dias (GET /dashboard -> evolucaoRisco), reconstruida
// do historico de status, sem cron; indice de risco tecnico global calculado no backend
// (kpis.indiceRiscoTecnico) com os pesos unicos; RBAC (null para o Colaborador).
// Cenarios datados: os eventos sao gravados ao meio-dia (Brasilia) de "k dias atras".
// Banco Postgres isolado (baluarte_test_evolucao_risco) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ANALISTA, ADMIN, chamar, encerrarServidor, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');
const { diasDaJanela, inicioDoDia } = await import('../src/services/evolucaoRisco.service.js');

type Ponto = { data: string; critico: number; alto: number; medio: number; baixo: number; arquivosMaliciosos: number; ativos: number; indice: number };

let analista: string;
let admin: string;
let colaborador: string;
let pontos: Ponto[];
let dashboard: { kpis: Record<string, number | null>; distribuicaoSeveridade: Record<string, number>; evolucaoRisco: Ponto[] };

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Meio-dia (Brasilia) de k dias atras: longe da virada do dia, o teste nao depende da hora em que roda. */
function meioDia(k: number): Date {
  const [ano, mes, dia] = new Date(Date.now() - k * DIA).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return new Date(inicioDoDia(ano, mes, dia).getTime() + 12 * HORA);
}

/** Ponto de k dias atras (k = 0 e hoje). */
const ponto = (k: number) => pontos[pontos.length - 1 - k];

/** A formula do frontend ate o B25b, com os pesos trocados para 10/7/4/1 (o que o backend deve dar). */
function indiceEsperado(c: number, a: number, m: number, b: number, ativos: number) {
  return Math.max(0, Math.min(100, Math.round(((c * 10 + a * 7 + m * 4 + b) / (Math.max(1, ativos) * 20)) * 100)));
}

/** Achado criado como a API cria (status inicial + evento de criacao) e as mudancas datadas. */
async function achado(
  scanId: string,
  chave: Parameters<typeof dadosAchado>[0],
  criadoEm: Date,
  mudancas: Array<[Date, string]> = [],
): Promise<string> {
  const final = mudancas.length ? mudancas[mudancas.length - 1][1] : 'Aberta';
  const f = await prisma.finding.create({ data: { ...dadosAchado(chave), scanId, criadoEm, status: final } });
  let de = 'Aberta';
  await prisma.findingStatusChange.create({ data: { findingId: f.id, de: null, para: 'Aberta', registradaEm: criadoEm } });
  for (const [quando, para] of mudancas) {
    await prisma.findingStatusChange.create({ data: { findingId: f.id, de, para, usuarioId: 'u-001', registradaEm: quando } });
    de = para;
  }
  return f.id;
}

async function lerDashboard(token: string) {
  const r = await chamar('GET', '/dashboard', { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados;
}

before(async () => {
  await iniciarServidor(app);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  admin = await login(ADMIN.email, ADMIN.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');

  // Os dois ativos do seed de contrato nasceram agora (contam so hoje). Mais dois, datados:
  const antigo = await prisma.asset.create({ data: { nome: 'Evo Antigo', host: '10.27.0.1', tipo: 'Servidor', criadoEm: new Date(Date.now() - 40 * DIA) } });
  const novo = await prisma.asset.create({ data: { nome: 'Evo Novo', host: '10.27.0.2', tipo: 'Servidor', criadoEm: meioDia(8) } });
  const scan = await prisma.scan.create({ data: { assetId: antigo.id, status: 'CONCLUIDA', criadoEm: meioDia(36), concluidoEm: meioDia(36) } });
  const scanNovo = await prisma.scan.create({ data: { assetId: novo.id, status: 'CONCLUIDA', criadoEm: meioDia(8), concluidoEm: meioDia(8) } });

  // Critico criado ha 10 dias e resolvido ha 3.
  await achado(scan.id, 'injecao-sql', meioDia(10), [[meioDia(6), 'Em revisão'], [meioDia(3), 'Resolvida']]);
  // Alto criado ha 20 dias, ainda aberto.
  await achado(scan.id, 'controle-acesso', meioDia(20));
  // Medio criado ha 5 dias, risco aceito ha 2 e reaberto ontem.
  await achado(scanNovo.id, 'idor', meioDia(5), [[meioDia(2), 'Risco aceito'], [meioDia(1), 'Aberta']]);
  // Baixo criado hoje (agora), aberto.
  const baixo = await prisma.finding.create({
    data: { ...dadosAchado('cors-curinga'), cvss: 3.1, severidade: 'Baixo', cvssVetor: null, scanId: scanNovo.id, criadoEm: new Date(Date.now() - 1000) },
  });
  await prisma.findingStatusChange.create({ data: { findingId: baixo.id, de: null, para: 'Aberta', registradaEm: baixo.criadoEm } });
  // Critico criado e resolvido antes da janela: nunca aparece.
  await achado(scan.id, 'componente-vulneravel', meioDia(35), [[meioDia(32), 'Resolvida']]);
  // Alto criado ha 12 dias e resolvido POR FORA da API (sem evento): o passado segue os eventos
  // (aberto), mas hoje vale o status gravado (resolvido), para o ultimo ponto bater com os KPIs.
  const semEvento = await achado(scan.id, 'injecao-comando', meioDia(12));
  await prisma.finding.update({ where: { id: semEvento }, data: { status: 'Resolvida' } });

  // Arquivos com ameaca (B17): um ha 5 dias e outro ha 45 (so entra na janela de 30 dias dos dias antigos).
  const u = await prisma.user.findUniqueOrThrow({ where: { email: ANALISTA.email } });
  const sha = (c: string) => c.repeat(64);
  await prisma.fileScan.createMany({
    data: [
      { userId: u.id, nome: 'a.exe', tamanho: 10, sha256: sha('a'), resultado: 'AMEACA', ameaca: 'Eicar', criadoEm: meioDia(5) },
      { userId: u.id, nome: 'b.exe', tamanho: 10, sha256: sha('b'), resultado: 'AMEACA', ameaca: 'Eicar', criadoEm: meioDia(45) },
      { userId: u.id, nome: 'c.txt', tamanho: 10, sha256: sha('c'), resultado: 'LIMPO', criadoEm: meioDia(4) },
    ],
  });

  dashboard = await lerDashboard(analista);
  pontos = dashboard.evolucaoRisco;
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('evolução do risco (30 dias)', () => {
  it('30 dias consecutivos, do mais antigo a hoje, no fuso de Brasília', () => {
    assert.equal(pontos.length, 30);
    const esperadas = diasDaJanela(new Date()).map((d) => d.data);
    assert.deepEqual(pontos.map((p) => p.data), esperadas);
    assert.equal(ponto(0).data, new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  });

  it('crítico criado há 10 dias e resolvido há 3: conta do dia da criação até o dia anterior à resolução', () => {
    for (let k = 29; k >= 0; k--) assert.equal(ponto(k).critico, k >= 4 && k <= 10 ? 1 : 0, `crítico há ${k} dias`);
  });

  it('alto aberto há 20 dias; o resolvido sem evento conta no passado e sai hoje', () => {
    for (let k = 29; k >= 1; k--) assert.equal(ponto(k).alto, (k <= 20 ? 1 : 0) + (k <= 12 ? 1 : 0), `alto há ${k} dias`);
    assert.equal(ponto(0).alto, 1);
  });

  it('médio: risco aceito tira da conta, reabrir devolve; baixo criado hoje só conta hoje', () => {
    assert.deepEqual(
      [6, 5, 4, 3, 2, 1, 0].map((k) => ponto(k).medio),
      [0, 1, 1, 1, 0, 1, 1],
    );
    assert.deepEqual(pontos.map((p) => p.baixo), [...Array(29).fill(0), 1]);
  });

  it('dias sem evento repetem o estado anterior (zerados antes de qualquer achado)', () => {
    for (let k = 29; k >= 21; k--) assert.deepEqual([ponto(k).critico, ponto(k).alto, ponto(k).medio, ponto(k).baixo], [0, 0, 0, 0]);
    // Entre 19 e 13 dias atrás nada muda: o mesmo alto aberto.
    for (let k = 19; k >= 13; k--) assert.deepEqual([ponto(k).critico, ponto(k).alto, ponto(k).medio, ponto(k).baixo], [0, 1, 0, 0]);
  });

  it('arquivos maliciosos: a janela de 30 dias que termina em cada dia', () => {
    // O de 45 dias atrás entra até o dia em que ainda estava a menos de 30 dias (16 dias atrás).
    for (let k = 29; k >= 0; k--) {
      const esperado = (k >= 16 ? 1 : 0) + (k <= 5 ? 1 : 0);
      assert.equal(ponto(k).arquivosMaliciosos, esperado, `arquivos há ${k} dias`);
    }
  });

  it('ativos que já existiam em cada dia (capacidade do índice)', () => {
    for (let k = 29; k >= 1; k--) assert.equal(ponto(k).ativos, k <= 8 ? 2 : 1, `ativos há ${k} dias`);
    assert.equal(ponto(0).ativos, 4, 'hoje entram os dois do seed de contrato');
  });

  it('o índice de cada dia é a fórmula do KPI com os pesos 10/7/4/1', () => {
    for (const p of pontos) assert.equal(p.indice, indiceEsperado(p.critico + p.arquivosMaliciosos, p.alto, p.medio, p.baixo, p.ativos), p.data);
    // Há 4 dias: 1 crítico + 1 arquivo, 2 altos, 1 médio em 2 ativos = (20 + 14 + 4) / 40.
    assert.equal(ponto(4).indice, 95);
  });

  it('o último ponto (hoje) é exatamente o estado dos KPIs', () => {
    const hoje = ponto(0);
    const d = dashboard.distribuicaoSeveridade;
    assert.equal(hoje.critico + hoje.arquivosMaliciosos, d['Crítico']);
    assert.deepEqual([hoje.alto, hoje.medio, hoje.baixo], [d['Alto'], d['Médio'], d['Baixo']]);
    assert.equal(hoje.arquivosMaliciosos, dashboard.kpis.arquivosMaliciosos);
    assert.equal(hoje.ativos, dashboard.kpis.ativosMonitorados);
    assert.equal(hoje.indice, dashboard.kpis.indiceRiscoTecnico);
  });

  it('mudar um status hoje muda só o ponto de hoje', async () => {
    const [alto] = await prisma.finding.findMany({ where: { severidade: 'Alto', status: 'Aberta' }, select: { id: true } });
    const r = await chamar('PATCH', `/vulnerabilidades/${alto.id}`, { token: analista, body: { status: 'Em remediação' } });
    assert.equal(r.status, 200);
    let depois = (await lerDashboard(analista)).evolucaoRisco as Ponto[];
    assert.deepEqual(depois.slice(0, 29), pontos.slice(0, 29));
    assert.equal(depois[29].alto, 1, '"Em remediação" continua aberto');
    await chamar('PATCH', `/vulnerabilidades/${alto.id}`, { token: analista, body: { status: 'Resolvida' } });
    depois = (await lerDashboard(analista)).evolucaoRisco as Ponto[];
    assert.deepEqual(depois.slice(0, 29), pontos.slice(0, 29));
    assert.equal(depois[29].alto, 0);
  });
});

describe('índice de risco técnico global no backend', () => {
  it('kpis.indiceRiscoTecnico = cálculo antigo do frontend com os pesos 10/7/4/1 sobre a distribuição', () => {
    const d = dashboard.distribuicaoSeveridade;
    assert.equal(
      dashboard.kpis.indiceRiscoTecnico,
      indiceEsperado(d['Crítico'], d['Alto'], d['Médio'], d['Baixo'], dashboard.kpis.ativosMonitorados as number),
    );
    // 1 arquivo (crítico) + 1 alto + 1 médio + 1 baixo em 4 ativos: 22 / 80.
    assert.equal(dashboard.kpis.indiceRiscoTecnico, 28);
  });
});

describe('RBAC', () => {
  it('Administrador recebe o mesmo índice e a mesma evolução do Analista', async () => {
    const d = await lerDashboard(admin);
    const a = await lerDashboard(analista);
    assert.equal(d.kpis.indiceRiscoTecnico, a.kpis.indiceRiscoTecnico);
    assert.deepEqual(d.evolucaoRisco, a.evolucaoRisco);
  });

  it('Colaborador: índice e evolução vêm null, como os outros KPIs técnicos', async () => {
    const d = await lerDashboard(colaborador);
    assert.equal(d.kpis.indiceRiscoTecnico, null);
    assert.equal(d.evolucaoRisco, null);
    assert.equal(d.distribuicaoSeveridade, null);
  });

  it('sem token: 401', async () => {
    const r = await chamar('GET', '/dashboard');
    assert.equal(r.status, 401);
  });
});
