// GET /treinamentos/consolidado (tela de treinamentos numa requisicao so) e os campos
// achadosAbertos/ultimaVarredura de GET /assets. Banco isolado (ver helpers.ts).
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
const { CATALOGO_ACHADOS, dadosAchado } = await import('../src/models/catalogoAchado.model.js');

let admin = '';
let analista = '';

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

type Consolidado = {
  campanhas: number;
  conclusoes: number;
  cliques: number;
  pendentesAposClique: number;
  conclusoesNominais: number;
  colaboradores: { nome: string; email: string; departamento: string; campanhas: { id: string; nome: string }[] }[];
  porDepartamento: { departamento: string; conclusoes: number }[];
};

async function consolidado(token = analista): Promise<Consolidado> {
  const r = await chamar('GET', '/treinamentos/consolidado', { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as Consolidado;
}

describe('GET /treinamentos/consolidado', () => {
  it('RBAC: Administrador e Analista leem; Colaborador -> 403; sem token -> 401', async () => {
    await consolidado(admin);
    await consolidado(analista);
    const colab = await criarUsuario(admin, 'Colaborador', 'cons-rbac');
    esperaErro(await chamar('GET', '/treinamentos/consolidado', { token: await login(colab.email, SENHA_CONTA) }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/treinamentos/consolidado'), 401, 'TOKEN_AUSENTE');
  });

  it('soma cliques e conclusões de todas as campanhas e agrupa por pessoa e departamento', async () => {
    const antes = await consolidado();
    const [a, b, c] = [
      await criarUsuario(admin, 'Colaborador', 'cons-a'),
      await criarUsuario(admin, 'Colaborador', 'cons-b'),
      await criarUsuario(admin, 'Colaborador', 'cons-c'),
    ];
    await chamar('PATCH', `/users/${a.id}`, { token: admin, body: { departamento: 'RH' } });
    const agora = new Date();
    const evento = (userId: string, email: string, clicou: boolean, treinou: boolean) => ({
      userId, destinatario: email, enviadoEm: agora,
      clicadoEm: clicou ? agora : null, treinou, treinouEm: treinou ? agora : null,
    });
    const c1 = await prisma.campaign.create({
      data: { nome: 'Consolidado 1', template: 'urgencia', status: 'ATIVA', eventos: { create: [
        evento(a.id, a.email, true, true), evento(b.id, b.email, true, false), evento(c.id, c.email, false, false),
      ] } },
    });
    const c2 = await prisma.campaign.create({
      data: { nome: 'Consolidado 2', template: 'autoridade', status: 'ATIVA', eventos: { create: [evento(a.id, a.email, true, true)] } },
    });

    const d = await consolidado();
    assert.equal(d.campanhas - antes.campanhas, 2);
    assert.equal(d.cliques - antes.cliques, 3);
    assert.equal(d.conclusoes - antes.conclusoes, 2);
    assert.equal(d.pendentesAposClique, Math.max(0, d.cliques - d.conclusoes));
    assert.equal(d.conclusoesNominais, d.conclusoes);

    const pessoaA = d.colaboradores.find((p) => p.email === a.email.toLowerCase());
    assert.ok(pessoaA, 'quem concluiu aparece na lista');
    assert.equal(pessoaA.departamento, 'RH');
    assert.deepEqual(pessoaA.campanhas.map((x) => x.id).sort(), [c1.id, c2.id].sort());
    // Quem clicou sem concluir, ou nem clicou, não aparece.
    assert.ok(!d.colaboradores.some((p) => p.email === b.email.toLowerCase() || p.email === c.email.toLowerCase()));

    const rh = (x: Consolidado) => x.porDepartamento.find((g) => g.departamento === 'RH')?.conclusoes ?? 0;
    assert.equal(rh(d) - rh(antes), 2);
  });

  it('bate com a soma dos relatórios de cada campanha (mesma regra de conclusão)', async () => {
    const d = await consolidado();
    const lista = await chamar('GET', '/campanhas', { token: analista });
    let conclusoes = 0;
    for (const camp of lista.body.dados as { id: string }[]) {
      const rel = await chamar('GET', `/campanhas/${camp.id}`, { token: analista });
      conclusoes += (rel.body.dados.treinamentos as { concluido: boolean }[]).filter((t) => t.concluido).length;
    }
    assert.equal(d.conclusoes, conclusoes);
    assert.equal(d.campanhas, (lista.body.dados as unknown[]).length);
  });

  it('ordena colaboradores por nº de campanhas e departamentos por conclusões', async () => {
    const d = await consolidado();
    for (let i = 1; i < d.colaboradores.length; i++) {
      const [x, y] = [d.colaboradores[i - 1], d.colaboradores[i]];
      assert.ok(x.campanhas.length > y.campanhas.length || (x.campanhas.length === y.campanhas.length && x.nome.localeCompare(y.nome, 'pt-BR') <= 0));
    }
    for (let i = 1; i < d.porDepartamento.length; i++) assert.ok(d.porDepartamento[i - 1].conclusoes >= d.porDepartamento[i].conclusoes);
  });
});

describe('GET /assets: achadosAbertos e ultimaVarredura', () => {
  it('conta só os achados em aberto e devolve a varredura mais recente; ativo sem varredura -> null', async () => {
    const novo = await chamar('POST', '/assets', { token: analista, body: { nome: 'Ativo consolidado', tipo: 'Servidor', host: '10.77.0.1' } });
    assert.equal(novo.status, 201, JSON.stringify(novo.body));
    const id = novo.body.dados.id as string;

    const semVarredura = (await chamar('GET', '/assets', { token: analista })).body.dados.find((x: { id: string }) => x.id === id);
    assert.equal(semVarredura.achadosAbertos, 0);
    assert.equal(semVarredura.ultimaVarredura, null);

    const [k1, k2, k3] = Object.keys(CATALOGO_ACHADOS) as (keyof typeof CATALOGO_ACHADOS)[];
    const antiga = await prisma.scan.create({
      data: { assetId: id, status: 'CONCLUIDA', criadoEm: new Date(Date.now() - 3600_000), concluidoEm: new Date(Date.now() - 3500_000) },
    });
    await prisma.finding.create({ data: { ...dadosAchado(k1), scanId: antiga.id, status: 'Aberta' } });
    const recente = await prisma.scan.create({ data: { assetId: id, status: 'CONCLUIDA', concluidoEm: new Date() } });
    await prisma.finding.create({ data: { ...dadosAchado(k2), scanId: recente.id, status: 'Em revisão' } });
    await prisma.finding.create({ data: { ...dadosAchado(k3), scanId: recente.id, status: 'Resolvida' } });

    const ativo = (await chamar('GET', '/assets', { token: analista })).body.dados.find((x: { id: string }) => x.id === id);
    assert.equal(ativo.achadosAbertos, 2, 'Aberta + Em revisão; Resolvida não conta');
    assert.equal(ativo.ultimaVarredura.id, recente.id);
    assert.equal(ativo.ultimaVarredura.status, 'CONCLUIDA');
    assert.equal(ativo._count.scans, 2, 'o campo antigo continua');
    assert.equal(ativo.scans, undefined, 'a lista de varreduras não vaza no payload');
  });
});
