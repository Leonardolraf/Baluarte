// B30 (RNF-004) — o dashboard agrega os achados em aberto no banco (contagem por severidade,
// criticos e so os 5 mais recentes) em vez de trazer a lista inteira a cada leitura. Estes testes
// conferem que o resultado e o mesmo da regra antiga, calculada aqui a partir do banco: com volume,
// achados encerrados mais novos que os abertos e empate de data (desempate pelo id).
// Banco Postgres isolado (baluarte_test_dashboard) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, SENHA_CONTA, chamar, criarUsuario, encerrarServidor, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');
const { STATUS_FINDING, STATUS_FINDING_ENCERRADO } = await import('../src/models/dominio.model.js');
const { abertosPorDia } = await import('../src/repositories/vulnerabilidade.repository.js');

const CHAVES = ['injecao-sql', 'idor', 'sem-bloqueio-login', 'sessao-sem-expiracao', 'cors-curinga', 'injecao-comando'] as const;
const DIA_MS = 24 * 60 * 60 * 1000;

let analista: string;

before(async () => {
  await iniciarServidor(app);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  const scan = await prisma.scan.create({ data: { assetId: 'ativo-001', status: 'CONCLUIDA', concluidoEm: new Date() } });
  const agora = Date.now();
  // 200 achados com todos os status e notas, datas espalhadas e alguns empates de data.
  await prisma.finding.createMany({
    data: Array.from({ length: 200 }, (_, i) => ({
      ...dadosAchado(CHAVES[i % CHAVES.length]),
      scanId: scan.id,
      status: STATUS_FINDING[i % STATUS_FINDING.length],
      criadoEm: new Date(agora - Math.floor(i / 3) * DIA_MS),
    })),
  });
  // Os dois mais novos de todos estao encerrados: nao podem aparecer em recentes nem em alertas.
  for (const status of STATUS_FINDING_ENCERRADO)
    await prisma.finding.create({ data: { ...dadosAchado('injecao-sql'), scanId: scan.id, status, criadoEm: new Date(agora + DIA_MS) } });
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('dashboard com achados agregados no banco (B30, RNF-004)', () => {
  it('KPIs, distribuição, recentes e alertas iguais à regra calculada sobre todos os achados', async () => {
    const r = await chamar('GET', '/dashboard', { token: analista });
    assert.equal(r.status, 200);
    const d = r.body.dados;

    const abertos = (
      await prisma.finding.findMany({
        include: { scan: { include: { asset: true } } },
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      })
    ).filter((f) => !STATUS_FINDING_ENCERRADO.includes(f.status));
    assert.ok(abertos.length > 100, 'a massa precisa ter volume');

    const sev: Record<string, number> = { 'Crítico': 0, 'Alto': 0, 'Médio': 0, 'Baixo': 0 };
    for (const f of abertos) sev[f.severidade] += 1;

    assert.equal(d.kpis.vulnerabilidadesAbertas, abertos.length);
    assert.equal(d.kpis.criticas, abertos.filter((f) => f.cvss >= 9.0).length);
    assert.deepEqual(d.distribuicaoSeveridade, sev);
    assert.deepEqual(
      d.vulnerabilidadesRecentes.map((v: { id: string }) => v.id),
      abertos.slice(0, 5).map((f) => f.id),
    );
    assert.deepEqual(
      d.alertas.map((a: { id: string }) => a.id),
      abertos.slice(0, 3).map((f) => f.id),
    );
    // O recente sai no mesmo formato da lista de vulnerabilidades (host do ativo, remediação numerada).
    const primeiro = d.vulnerabilidadesRecentes[0];
    assert.equal(primeiro.ativo, abertos[0].scan.asset.host);
    assert.ok(Array.isArray(primeiro.remediacao) && primeiro.remediacao.length > 0);
    assert.match(d.alertas[0].texto, new RegExp(`em ${abertos[0].scan.asset.host.replace(/\./g, '\\.')}$`));
  });

  it('encerrar um achado recente tira ele de recentes e o próximo em aberto entra no lugar', async () => {
    const antes = (await chamar('GET', '/dashboard', { token: analista })).body.dados;
    const alvo = antes.vulnerabilidadesRecentes[0].id;
    const r = await chamar('PATCH', `/vulnerabilidades/${alvo}`, { token: analista, body: { status: 'Resolvida' } });
    assert.equal(r.status, 200);

    const depois = (await chamar('GET', '/dashboard', { token: analista })).body.dados;
    assert.equal(depois.kpis.vulnerabilidadesAbertas, antes.kpis.vulnerabilidadesAbertas - 1);
    const ids = depois.vulnerabilidadesRecentes.map((v: { id: string }) => v.id);
    assert.ok(!ids.includes(alvo));
    assert.deepEqual(ids.slice(0, 4), antes.vulnerabilidadesRecentes.slice(1).map((v: { id: string }) => v.id));
    assert.equal(ids.length, 5);
  });
});

describe('evolução de 30 dias por trechos do histórico (B30, RNF-004)', () => {
  it('conta igual à busca "último evento até o fim do dia", com empate no mesmo instante e achado sem evento', async () => {
    const scan = await prisma.scan.create({ data: { assetId: 'ativo-001', status: 'CONCLUIDA', concluidoEm: new Date() } });
    const agora = Date.now();
    const criar = (status: string, diasAtras: number) =>
      prisma.finding.create({ data: { ...dadosAchado('idor'), scanId: scan.id, status, criadoEm: new Date(agora - diasAtras * DIA_MS) } });
    // Dois eventos no MESMO instante: vale o de id maior (Resolvida).
    const empate = await criar('Resolvida', 8);
    const instante = new Date(agora - 5 * DIA_MS);
    await prisma.findingStatusChange.create({ data: { findingId: empate.id, de: null, para: 'Aberta', registradaEm: new Date(agora - 8 * DIA_MS) } });
    await prisma.findingStatusChange.create({ data: { findingId: empate.id, de: 'Aberta', para: 'Em revisão', registradaEm: instante } });
    await prisma.findingStatusChange.create({ data: { findingId: empate.id, de: 'Em revisão', para: 'Resolvida', registradaEm: instante } });
    // Sem nenhum evento (inserido por fora da API): o passado usa o status gravado.
    await criar('Risco aceito', 6);
    // Primeiro evento DEPOIS da criação: antes dele, o status gravado.
    const tardio = await criar('Aberta', 12);
    await prisma.findingStatusChange.create({ data: { findingId: tardio.id, de: null, para: 'Aberta', registradaEm: new Date(agora - 4 * DIA_MS) } });

    const fins = Array.from({ length: 30 }, (_, i) => new Date(agora - (29 - i) * DIA_MS + 1000));
    const obtido = await abertosPorDia(fins, STATUS_FINDING_ENCERRADO);

    // A regra de referência, achado a achado, em memória.
    const achados = await prisma.finding.findMany({ select: { id: true, status: true, severidade: true, criadoEm: true } });
    const eventos = await prisma.findingStatusChange.findMany({ orderBy: [{ registradaEm: 'asc' }, { id: 'asc' }] });
    const esperado = new Map<string, number>();
    fins.forEach((fim, i) => {
      const atual = i === fins.length - 1;
      for (const f of achados) {
        if (f.criadoEm > fim) continue;
        const ultimo = atual ? undefined : eventos.filter((e) => e.findingId === f.id && e.registradaEm <= fim).at(-1);
        const status = ultimo ? ultimo.para : f.status;
        if (STATUS_FINDING_ENCERRADO.includes(status)) continue;
        const chave = `${i + 1}|${f.severidade}`;
        esperado.set(chave, (esperado.get(chave) ?? 0) + 1);
      }
    });
    const comoMapa = new Map(obtido.map((r) => [`${r.dia}|${r.severidade}`, Number(r.total)]));
    assert.deepEqual([...comoMapa.entries()].sort(), [...esperado.entries()].sort());
  });
});

describe('risco humano calculado no servidor (pesos únicos PESO_RISCO_HUMANO)', () => {
  it('sem envio é null; com envio é a fórmula sobre os eventos, igual para Analista e Colaborador', async () => {
    const { PESO_RISCO_HUMANO } = await import('../src/models/dominio.model.js');
    const risco = async (token: string) => {
      const r = await chamar('GET', '/dashboard', { token });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.dados.kpis.riscoHumano as number | null;
    };
    assert.equal(await prisma.campaignEvent.count({ where: { enviadoEm: { not: null } } }), 0);
    assert.equal(await risco(analista), null, 'sem envio o risco humano não é medido (null, nunca 0)');

    // 5 destinatários: 1 clicou e entregou a senha, 4 só receberam -> clique 20 %, submissão 20 % -> 20x2 + 20x2 = 80.
    const admin = await login(ADMIN.email, ADMIN.senha);
    const pessoas = await Promise.all(['rh-1', 'rh-2', 'rh-3', 'rh-4', 'rh-5'].map((s) => criarUsuario(admin, 'Colaborador', s)));
    const agora = new Date();
    await prisma.campaign.create({
      data: {
        nome: 'Risco humano', template: 'urgencia', status: 'ATIVA',
        eventos: { create: pessoas.map((p, i) => ({
          userId: p.id, destinatario: p.email, enviadoEm: agora,
          clicadoEm: i === 0 ? agora : null, submeteuEm: i === 0 ? agora : null,
        })) },
      },
    });
    assert.equal(20 * PESO_RISCO_HUMANO.clique + 20 * PESO_RISCO_HUMANO.submissao, 80);
    assert.equal(await risco(analista), 80);
    // Como a resiliência, o risco humano é visível ao Colaborador (o gauge aparece no dashboard dele).
    assert.equal(await risco(await login(pessoas[1].email, SENHA_CONTA)), 80);
  });
});
