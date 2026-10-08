// B25 (parte sem migration) — relatorios avancados de vulnerabilidades:
// - GET /vulnerabilidades filtrada, ordenada e paginada NO BANCO (sem repetir nem pular
//   achado entre paginas), com resumo do filtro inteiro e 400 com codigo proprio;
// - o PDF do B24 continua exportando TODOS os achados do filtro, nao so uma pagina;
// - nota de risco por ativo em GET /assets (calculada na leitura) e os 5 ativos de maior
//   risco no dashboard (ordem, empate, RBAC);
// - historico honesto no detalhe do achado (deteccao + mudancas; desde o B25b, da tabela
//   FindingStatusChange, nao mais da trilha de auditoria).
// Banco Postgres isolado (baluarte_test_relatorios_avancados) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { ADMIN, ANALISTA, baixar, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');

type Chave = Parameters<typeof dadosAchado>[0];
type Dados = Omit<Prisma.FindingCreateManyInput, 'scanId'>;

let admin: string;
let analista: string;
let colaborador: string;

/** Ids por apelido, para os testes acharem os ativos e achados criados aqui. */
const ativo: Record<string, string> = {};
const achado: Record<string, string> = {};
let varreduraKappa = '';

/** Achado Baixo (o catalogo nao tem nenhum): mesma estrutura, nota 3.1. */
function baixo(): Dados {
  return { ...dadosAchado('cors-curinga'), cvss: 3.1, severidade: 'Baixo', cvssVetor: null };
}

async function criarAtivo(apelido: string, nome: string, host: string, achados: Array<[Dados, string]>) {
  const a = await prisma.asset.create({ data: { nome, host, tipo: 'Aplicacao' } });
  ativo[apelido] = a.id;
  const scan = await prisma.scan.create({ data: { assetId: a.id, status: 'CONCLUIDA', concluidoEm: new Date() } });
  if (achados.length) await prisma.finding.createMany({ data: achados.map(([dados, status]) => ({ ...dados, scanId: scan.id, status })) });
  return scan.id;
}

const repetir = (n: number, chave: Chave, status = 'Aberta') =>
  Array.from({ length: n }, () => [dadosAchado(chave), status] as [Dados, string]);
const de = (chave: Chave, status = 'Aberta') => [dadosAchado(chave), status] as [Dados, string];

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');

  // Pontos = 10 x Critico + 7 x Alto + 4 x Medio + 1 x Baixo (so abertos); nota = min(100, pontos).
  await criarAtivo('alfa', 'Portal Alfa', '10.25.0.1', [
    de('injecao-sql'), // Critico 9.8
    de('componente-vulneravel'), // Critico 9.1
    de('controle-acesso', 'Resolvida'), // Alto: resolvido nao conta
    de('idor', 'Risco aceito'), // Medio: risco aceito nao conta
  ]); // 20 pontos
  await criarAtivo('beta', 'Banco Beta', '10.25.0.2', [
    de('injecao-comando', 'Em revisão'), // Alto (em revisao conta como aberto)
    de('sem-bloqueio-login'), // Alto
    de('cookie-inseguro', 'Em remediação'), // Medio
  ]); // 18 pontos
  await criarAtivo('gama', 'Gateway Gama', 'gama.empresa.com', [de('injecao-sql', 'Resolvida'), de('idor', 'Resolvida')]); // 0
  await criarAtivo('delta', 'Delta', '10.25.0.4', [de('injecao-sql')]); // 10 pontos, 1 critico
  await criarAtivo('epsilon', 'Epsilon', '10.25.0.5', [de('controle-acesso'), [baixo(), 'Aberta'], [baixo(), 'Aberta'], [baixo(), 'Aberta']]); // 10, 0 critico
  await criarAtivo('zeta', 'Zeta', '10.25.0.6', [de('idor')]); // 4
  await criarAtivo('teta', 'Teta', '10.25.0.8', repetir(12, 'injecao-sql')); // 120 -> 100
  await criarAtivo('iota', 'Iota', '10.25.0.9', repetir(11, 'injecao-sql')); // 110 -> 100
  varreduraKappa = await criarAtivo('kappa', 'Kappa', '10.25.0.10', [de('idor'), [baixo(), 'Em revisão']]); // historico

  for (const f of await prisma.finding.findMany({ where: { scan: { assetId: ativo.kappa } }, select: { id: true, severidade: true } }))
    achado[f.severidade === 'Baixo' ? 'kappaBaixo' : 'kappaMedio'] = f.id;
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

const listar = (query = '', token = analista) => chamar('GET', `/vulnerabilidades${query}`, { token });

async function listarOk(query = '') {
  const r = await listar(query);
  assert.equal(r.status, 200, `esperava 200 para ${query}, veio ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { dados: Array<{ id: string; cvss: number; detectadoEm: string; ativo: string }>; resumo: any };
}

/** Percorre todas as paginas de uma consulta e devolve os ids na ordem recebida. */
async function todasAsPaginas(query: string, tamanho: number) {
  const ids: string[] = [];
  const linhas: Array<{ id: string; cvss: number; detectadoEm: string }> = [];
  let total = Infinity;
  for (let pagina = 1; (pagina - 1) * tamanho < total; pagina++) {
    const { dados, resumo } = await listarOk(`${query}${query ? '&' : '?'}pagina=${pagina}&tamanho=${tamanho}`);
    total = resumo.total;
    assert.ok(dados.length <= tamanho);
    ids.push(...dados.map((d) => d.id));
    linhas.push(...dados);
  }
  return { ids, linhas, total };
}

/** Quantidade de achados gravada nos metadados (Subject) do PDF. */
function achadosNoPdf(pdf: Buffer): number {
  const m = pdf.toString('latin1').match(/\(Achados: (\d+)\)/);
  assert.ok(m, 'Subject com a quantidade de achados');
  return Number(m[1]);
}

describe('lista paginada no servidor', () => {
  it('sem parâmetros: primeira página de 20, a mais recente primeiro, com o resumo do filtro inteiro', async () => {
    const total = await prisma.finding.count();
    assert.ok(total > 20, 'o cenário precisa de mais de uma página');
    const { dados, resumo } = await listarOk();
    assert.equal(dados.length, 20);
    assert.equal(resumo.total, total);
    assert.equal(resumo.pagina, 1);
    assert.equal(resumo.tamanho, 20);
    assert.equal(resumo.ativos, 9, 'ativos com algum achado (o seed não tem achados)');
    const datas = dados.map((d) => new Date(d.detectadoEm).getTime());
    assert.deepEqual(datas, [...datas].sort((a, b) => b - a));
    // Contagens por severidade e por status cobrem o filtro inteiro, com os zeros.
    assert.deepEqual(Object.keys(resumo.porSeveridade), ['Crítico', 'Alto', 'Médio', 'Baixo']);
    assert.equal(Object.values(resumo.porSeveridade as Record<string, number>).reduce((a, b) => a + b, 0), total);
    assert.equal(resumo.porSeveridade['Crítico'], await prisma.finding.count({ where: { severidade: 'Crítico' } }));
    assert.equal(resumo.porSeveridade['Baixo'], 4);
    assert.deepEqual(Object.keys(resumo.porStatus), ['Aberta', 'Em revisão', 'Em remediação', 'Resolvida', 'Risco aceito']);
    assert.equal(resumo.porStatus['Resolvida'], 3);
    assert.equal(resumo.porStatus['Risco aceito'], 1);
  });

  it('percorrer as páginas não repete nem pula achado (mesmo com CVSS e data empatados)', async () => {
    const todos = (await prisma.finding.findMany({ select: { id: true } })).map((f) => f.id).sort();
    for (const [query, tamanho] of [['', 7], ['?ordenar=cvss&direcao=desc', 3], ['?ordenar=cvss&direcao=asc', 5], ['?ordenar=descricao', 4]] as const) {
      const { ids, total } = await todasAsPaginas(query, tamanho);
      assert.equal(ids.length, total, `quantidade lida = total (${query})`);
      assert.equal(new Set(ids).size, ids.length, `sem repetição (${query})`);
      assert.deepEqual([...ids].sort(), todos, `sem omissão (${query})`);
    }
  });

  it('a ordem é estável: duas leituras da mesma página devolvem os mesmos achados na mesma ordem', async () => {
    const a = await listarOk('?ordenar=cvss&direcao=desc&pagina=2&tamanho=4');
    const b = await listarOk('?ordenar=cvss&direcao=desc&pagina=2&tamanho=4');
    assert.deepEqual(a.dados.map((d) => d.id), b.dados.map((d) => d.id));
  });

  it('ordena por CVSS nas duas direções', async () => {
    const desc = (await todasAsPaginas('?ordenar=cvss&direcao=desc', 10)).linhas.map((l) => l.cvss);
    assert.deepEqual(desc, [...desc].sort((x, y) => y - x));
    const asc = (await todasAsPaginas('?ordenar=cvss&direcao=asc', 10)).linhas.map((l) => l.cvss);
    assert.deepEqual(asc, [...asc].sort((x, y) => x - y));
  });

  it('página depois da última: lista vazia com o total', async () => {
    const { dados, resumo } = await listarOk('?pagina=50&tamanho=20');
    assert.equal(dados.length, 0);
    assert.equal(resumo.total, await prisma.finding.count());
    assert.equal(resumo.pagina, 50);
  });

  it('tamanho máximo 100 traz tudo numa página', async () => {
    const { dados, resumo } = await listarOk('?tamanho=100');
    assert.equal(dados.length, resumo.total);
  });
});

describe('filtros no banco', () => {
  it('severidade, status e busca (sem diferenciar maiúsculas) restringem lista e resumo', async () => {
    const casos: Array<[string, number, number]> = [
      // [query, total, ativos]
      ['?severidade=Crítico', 27, 5],
      ['?severidade=cr%C3%ADtico', 27, 5],
      ['?severidade=Baixo', 4, 2],
      ['?status=Resolvida', 3, 2],
      ['?status=em%20revis%C3%A3o', 2, 2],
      ['?q=10.25.0.2', 3, 1],
      ['?q=GAMA.EMPRESA', 2, 1],
      ['?q=injection', 27, 6],
      ['?severidade=Crítico&status=Aberta&q=10.25.0.1', 2, 1],
      ['?severidade=&status=&q=', 40, 9],
      ['?q=%20%20', 40, 9],
    ];
    for (const [query, total, ativos] of casos) {
      const { dados, resumo } = await listarOk(`${query}${query.includes('?') ? '&' : '?'}tamanho=100`);
      assert.equal(resumo.total, total, `total para ${query}`);
      assert.equal(dados.length, total, `linhas para ${query}`);
      assert.equal(resumo.ativos, ativos, `ativos para ${query}`);
    }
  });

  it('as contagens do resumo seguem o filtro', async () => {
    const { resumo } = await listarOk('?status=Aberta');
    assert.equal(resumo.porStatus['Aberta'], resumo.total);
    assert.equal(resumo.porStatus['Resolvida'], 0);
    assert.equal(resumo.porSeveridade['Baixo'], 3);
  });

  it('a busca é literal: %, _ e a barra invertida não viram curinga nem escape', async () => {
    for (const q of ['%25', '_', '10.25.0._', '%25injection', '%5C', '10.25%5C']) {
      const { resumo } = await listarOk(`?q=${q}`);
      assert.equal(resumo.total, 0, `q=${decodeURIComponent(q)} não deve casar nada`);
    }
  });
});

describe('parâmetros inválidos da lista: 400 com código próprio', () => {
  it('filtros, paginação e ordenação', async () => {
    const casos: Array<[string, string]> = [
      ['?severidade=Grav%C3%ADssimo', 'SEVERIDADE_INVALIDA'],
      ['?severidade[]=Alto', 'SEVERIDADE_INVALIDA'],
      ['?severidade=Alto&severidade=Baixo', 'SEVERIDADE_INVALIDA'],
      ['?status=Fechada', 'STATUS_INVALIDO'],
      ['?status[$ne]=Aberta', 'STATUS_INVALIDO'],
      [`?q=${'a'.repeat(101)}`, 'BUSCA_INVALIDA'],
      ['?q[$ne]=x', 'BUSCA_INVALIDA'],
      ['?pagina=0', 'PAGINA_INVALIDA'],
      ['?pagina=-1', 'PAGINA_INVALIDA'],
      ['?pagina=1.5', 'PAGINA_INVALIDA'],
      ['?pagina=abc', 'PAGINA_INVALIDA'],
      ['?pagina[]=1', 'PAGINA_INVALIDA'],
      ['?tamanho=0', 'TAMANHO_INVALIDO'],
      ['?tamanho=101', 'TAMANHO_INVALIDO'],
      ['?tamanho=10&tamanho=20', 'TAMANHO_INVALIDO'],
      ['?ordenar=criadoEm', 'ORDENACAO_INVALIDA'],
      ['?ordenar=cvss;DROP', 'ORDENACAO_INVALIDA'],
      ['?ordenar=cvss&direcao=cima', 'DIRECAO_INVALIDA'],
      ['?direcao=DESC', 'DIRECAO_INVALIDA'],
    ];
    for (const [query, codigo] of casos) esperaErro(await listar(query), 400, codigo);
  });

  it('Colaborador continua sem acesso à lista (403)', async () => {
    esperaErro(await listar('', colaborador), 403, 'PERFIL_SEM_PERMISSAO');
  });
});

describe('relatório em PDF com a lista paginada', () => {
  it('exporta TODOS os achados do filtro, não só a primeira página', async () => {
    const lista = await listarOk('?severidade=Crítico');
    assert.equal(lista.dados.length, 20, 'a lista devolve uma página');
    assert.equal(lista.resumo.total, 27);
    const pdf = await baixar('/vulnerabilidades/relatorio.pdf?severidade=Crítico', analista);
    assert.equal(pdf.status, 200);
    assert.equal(achadosNoPdf(pdf.corpo), 27);

    const tudo = await baixar('/vulnerabilidades/relatorio.pdf', analista);
    assert.equal(achadosNoPdf(tudo.corpo), await prisma.finding.count());
  });

  it('o relatório ignora pagina/tamanho (não pagina) e usa os mesmos filtros da lista', async () => {
    const pdf = await baixar('/vulnerabilidades/relatorio.pdf?q=10.25.0.2&pagina=2&tamanho=1', analista);
    assert.equal(pdf.status, 200);
    assert.equal(achadosNoPdf(pdf.corpo), (await listarOk('?q=10.25.0.2')).resumo.total);
  });
});

type AtivoApi = { id: string; host: string; notaRisco: number; achadosAbertos: number; abertosPorSeveridade: Record<string, number> };

async function ativosPorId(): Promise<Map<string, AtivoApi>> {
  const r = await chamar('GET', '/assets', { token: analista });
  assert.equal(r.status, 200);
  return new Map((r.body.dados as AtivoApi[]).map((a) => [a.id, a]));
}

describe('nota de risco por ativo (GET /assets)', () => {
  it('soma ponderada dos achados abertos, de 0 a 100', async () => {
    const ativos = await ativosPorId();
    const esperado: Array<[string, number, number, Record<string, number>]> = [
      ['alfa', 20, 2, { 'Crítico': 2, 'Alto': 0, 'Médio': 0, 'Baixo': 0 }],
      ['beta', 18, 3, { 'Crítico': 0, 'Alto': 2, 'Médio': 1, 'Baixo': 0 }],
      ['delta', 10, 1, { 'Crítico': 1, 'Alto': 0, 'Médio': 0, 'Baixo': 0 }],
      ['epsilon', 10, 4, { 'Crítico': 0, 'Alto': 1, 'Médio': 0, 'Baixo': 3 }],
      ['teta', 100, 12, { 'Crítico': 12, 'Alto': 0, 'Médio': 0, 'Baixo': 0 }],
    ];
    for (const [apelido, nota, abertos, porSeveridade] of esperado) {
      const a = ativos.get(ativo[apelido])!;
      assert.equal(a.notaRisco, nota, `nota de ${apelido}`);
      assert.equal(a.achadosAbertos, abertos, `abertos de ${apelido}`);
      assert.deepEqual(a.abertosPorSeveridade, porSeveridade, `por severidade de ${apelido}`);
    }
  });

  it('sem achado aberto: nota 0 (só resolvidos, ou nenhum achado)', async () => {
    const ativos = await ativosPorId();
    const gama = ativos.get(ativo.gama)!;
    assert.equal(gama.notaRisco, 0);
    assert.equal(gama.achadosAbertos, 0);
    assert.deepEqual(gama.abertosPorSeveridade, { 'Crítico': 0, 'Alto': 0, 'Médio': 0, 'Baixo': 0 });
    // Ativos do seed de contrato não têm varredura.
    assert.equal(ativos.get('ativo-001')!.notaRisco, 0);
  });
});

type MaiorRisco = { id: string; nome: string; host: string; notaRisco: number; achadosAbertos: number; abertosPorSeveridade: Record<string, number> };

async function maiorRisco(token = analista): Promise<MaiorRisco[]> {
  const r = await chamar('GET', '/dashboard', { token });
  assert.equal(r.status, 200);
  return r.body.dados.ativosMaiorRisco as MaiorRisco[];
}

describe('5 ativos de maior risco (dashboard)', () => {
  it('ordem pela nota; empate no teto pelos pontos; empate de nota pelos críticos', async () => {
    const top = await maiorRisco();
    assert.deepEqual(
      top.map((a) => a.id),
      [ativo.teta, ativo.iota, ativo.alfa, ativo.beta, ativo.delta],
      'Teta (120 pts) > Iota (110) > Alfa (20) > Beta (18) > Delta (10, 1 crítico) > Epsilon (10, 0 crítico)',
    );
    assert.deepEqual(top[0], {
      id: ativo.teta,
      nome: 'Teta',
      host: '10.25.0.8',
      notaRisco: 100,
      achadosAbertos: 12,
      abertosPorSeveridade: { 'Crítico': 12, 'Alto': 0, 'Médio': 0, 'Baixo': 0 },
    });
    assert.ok(!top.some((a) => a.id === ativo.gama), 'ativo sem achado aberto não entra');
  });

  it('Administrador vê o mesmo ranking; Colaborador não recebe a lista (dado técnico)', async () => {
    assert.deepEqual(await maiorRisco(admin), await maiorRisco(analista));
    const r = await chamar('GET', '/dashboard', { token: colaborador });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.ativosMaiorRisco, []);
    // Coerente com o B10: para o Colaborador os KPIs técnicos vêm null e as listas técnicas vazias.
    assert.equal(r.body.dados.kpis.vulnerabilidadesAbertas, null);
    assert.equal(r.body.dados.kpis.ativosMonitorados, null);
  });
});

type Detalhe = {
  id: string;
  status: string;
  origem: { varreduraId: string; ativoId: string; varreduraIniciadaEm: string };
  historico: {
    eventos: Array<{ tipo: string; quando: string; de?: string; para?: string; autor?: { id: string; nome: string } | null; ativo?: string; varreduraId?: string }>;
    statusAtual: string;
    completo: boolean;
  };
};

async function detalhe(id: string): Promise<Detalhe> {
  const r = await chamar('GET', `/vulnerabilidades/${id}`, { token: analista });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as Detalhe;
}

async function alterar(id: string, status: string): Promise<Detalhe> {
  const r = await chamar('PATCH', `/vulnerabilidades/${id}`, { token: analista, body: { status } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as Detalhe;
}

describe('histórico honesto do achado', () => {
  it('achado recém-detectado: só a detecção, com a varredura e o ativo de origem; completo', async () => {
    const d = await detalhe(achado.kappaMedio);
    assert.equal(d.origem.varreduraId, varreduraKappa);
    assert.equal(d.origem.ativoId, ativo.kappa);
    assert.equal(d.historico.eventos.length, 1);
    assert.deepEqual(
      { ...d.historico.eventos[0], quando: undefined },
      { tipo: 'DETECTADO', quando: undefined, varreduraId: varreduraKappa, ativo: '10.25.0.10', ativoNome: 'Kappa' },
    );
    assert.equal(d.historico.statusAtual, 'Aberta');
    assert.equal(d.historico.completo, true);
  });

  it('status mudado fora da plataforma (sem registro na trilha): não inventa a mudança e avisa', async () => {
    const d = await detalhe(achado.kappaBaixo);
    assert.deepEqual(d.historico.eventos.map((e) => e.tipo), ['DETECTADO']);
    assert.equal(d.historico.statusAtual, 'Em revisão');
    assert.equal(d.historico.completo, false);
  });

  it('cada mudança de status vira um evento com autor, de e para; repetir o status não é evento', async () => {
    const primeira = await alterar(achado.kappaMedio, 'Em revisão');
    // A resposta do PATCH já traz o histórico com a mudança.
    assert.deepEqual(primeira.historico.eventos.map((e) => e.tipo), ['DETECTADO', 'STATUS_ALTERADO']);
    await alterar(achado.kappaMedio, 'Em remediação');
    await alterar(achado.kappaMedio, 'Em remediação');
    const d = await detalhe(achado.kappaMedio);
    const mudancas = d.historico.eventos.filter((e) => e.tipo === 'STATUS_ALTERADO');
    assert.deepEqual(mudancas.map((e) => [e.de, e.para]), [['Aberta', 'Em revisão'], ['Em revisão', 'Em remediação']]);
    assert.deepEqual(mudancas[0].autor, { id: 'u-001', nome: 'Analista de Segurança' });
    assert.ok(new Date(mudancas[0].quando) <= new Date(mudancas[1].quando));
    assert.equal(d.historico.completo, true);
  });

  it('B25b: a mudança vai para a tabela de histórico com autor; a aba lê a tabela, não a trilha de auditoria', async () => {
    const id = achado.kappaMedio;
    const eventos = await prisma.findingStatusChange.findMany({ where: { findingId: id }, orderBy: { id: 'asc' } });
    assert.deepEqual(
      eventos.map((e) => [e.de, e.para, e.usuarioId]),
      [['Aberta', 'Em revisão', 'u-001'], ['Em revisão', 'Em remediação', 'u-001']],
    );
    // Um registro de auditoria no formato antigo nao vira evento: a fonte agora e a tabela.
    await prisma.auditLog.create({
      data: { acao: 'ALTERAR_STATUS_VULNERABILIDADE', usuarioId: 'u-001', detalhe: `${id} (10.25.0.10, A01:2021 - Broken Access Control): Em remediação → Resolvida` },
    });
    const d = await detalhe(id);
    assert.equal(d.historico.eventos.filter((e) => e.tipo === 'STATUS_ALTERADO').length, 2);
    assert.equal(d.historico.completo, true);
  });

  it('autor que não existe mais sai como null; a cadeia que explica o status atual torna o histórico completo', async () => {
    await prisma.findingStatusChange.create({
      data: { findingId: achado.kappaBaixo, de: 'Aberta', para: 'Em revisão', usuarioId: 'conta-excluida' },
    });
    const d = await detalhe(achado.kappaBaixo);
    const [mudanca] = d.historico.eventos.filter((e) => e.tipo === 'STATUS_ALTERADO');
    assert.equal(mudanca.autor, null);
    assert.equal(d.historico.completo, true);
  });
});

describe('a nota acompanha as mudanças (calculada na leitura)', () => {
  it('resolver um achado baixa a nota do ativo e reordena o ranking na leitura seguinte', async () => {
    const antes = (await ativosPorId()).get(ativo.alfa)!;
    assert.equal(antes.notaRisco, 20);
    const [sql] = await prisma.finding.findMany({ where: { scan: { assetId: ativo.alfa }, severidade: 'Crítico' }, select: { id: true } });
    await alterar(sql.id, 'Resolvida');
    const depois = (await ativosPorId()).get(ativo.alfa)!;
    assert.equal(depois.notaRisco, 10);
    assert.equal(depois.achadosAbertos, 1);
    // Beta (18) passa à frente de Alfa (10).
    const top = await maiorRisco();
    assert.deepEqual(top.slice(2, 4).map((a) => a.id), [ativo.beta, ativo.delta]);
    await alterar(sql.id, 'Risco aceito');
    assert.equal((await ativosPorId()).get(ativo.alfa)!.notaRisco, 10, '"Risco aceito" também não conta');
  });
});
