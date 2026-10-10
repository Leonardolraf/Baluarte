// B18 — aviso ao colaborador sobre o monitoramento da estação (RNF-006, LGPD): o texto servido
// pela API, o registro de ciência por versão (idempotente, auditado), a lista do Administrador
// e a garantia de que o agente osquery só recebe consultas de programas, sistema e portas
// (o que o aviso promete). Banco Postgres isolado (baluarte_test_aviso_monitoramento).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  ADMIN,
  ANALISTA,
  chamar,
  criarUsuario,
  criarUsuarioPendente,
  encerrarServidor,
  esperaErro,
  iniciarServidor,
  login,
  prepararBanco,
  SENHA_CONTA,
} from './helpers.js';

prepararBanco(import.meta.url);

const SEGREDO = randomBytes(24).toString('hex');
process.env.OSQUERY_ENROLL_SECRET = SEGREDO;

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { VERSAO_AVISO, AVISO_RASCUNHO, TEXTO_AVISO, duracaoPorExtenso } = await import('../src/models/avisoMonitoramento.model.js');
const { QUERIES } = await import('../src/models/agente.model.js');

const AVISO = '/monitoramento/aviso';
const CIENCIA = '/monitoramento/ciencia';
const CIENCIAS = '/monitoramento/ciencias';

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

type Ciencia = {
  id: string;
  versao: string;
  registradaEm: string;
  usuario: { id: string; nome: string; email: string; perfil: string; status: string };
};
type Resumo = { total: number; pagina: number; tamanho: number; versaoAtual: string; pendentesVersaoAtual: number };

async function listar(query = '', token = admin) {
  const r = await chamar('GET', `${CIENCIAS}${query}`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as { status: string; dados: Ciencia[]; resumo: Resumo };
}

/** Um usuário novo, ativo e logado, para testes que não podem herdar ciência de outro. */
async function novoUsuario(perfil: 'Administrador' | 'Analista' | 'Colaborador' = 'Colaborador') {
  const u = await criarUsuario(admin, perfil, 'b18');
  return { ...u, token: await login(u.email, SENHA_CONTA) };
}

describe('GET /monitoramento/aviso', () => {
  it('sem token: 401', async () => {
    const r = await chamar('GET', AVISO);
    assert.equal(r.status, 401);
  });

  for (const [perfil, token] of [
    ['Administrador', () => admin],
    ['Analista', () => analista],
    ['Colaborador', () => colaborador],
  ] as const) {
    it(`${perfil}: texto aprovado, versão e ciência ainda não registrada`, async () => {
      const r = await chamar('GET', AVISO, { token: token() });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const d = r.body.dados;
      assert.equal(d.versao, VERSAO_AVISO);
      // Texto aprovado pelo Leo em 10/10/2026: deixou de ser rascunho.
      assert.equal(d.rascunho, false);
      assert.equal(d.titulo, TEXTO_AVISO.titulo);
      assert.equal(d.introducao, TEXTO_AVISO.introducao);
      assert.deepEqual(d.secoes, TEXTO_AVISO.secoes);
      assert.deepEqual(d.ciencia, { registrada: false, registradaEm: null });
    });
  }

  it('o texto cobre o que o cartão pede: coletado, não coletado, finalidade, acesso, retenção, base legal, dúvidas', async () => {
    const r = await chamar('GET', AVISO, { token: colaborador });
    const ids = (r.body.dados.secoes as { id: string }[]).map((s) => s.id);
    for (const id of ['coletado', 'nao-coletado', 'finalidade', 'acesso', 'retencao', 'base-legal', 'duvidas', 'ciencia'])
      assert.ok(ids.includes(id), `falta a seção ${id}`);
    const texto = JSON.stringify(r.body.dados);
    assert.match(texto, /art\. 7º, inciso IX/);
    assert.match(texto, /art\. 46/);
    for (const termo of ['programas instalados', 'sistema operacional', 'portas de rede', 'Administrador e Analista', 'inventário mais recente'])
      assert.ok(texto.includes(termo), `o texto não fala de "${termo}"`);
    for (const naoColetado of ['arquivos e documentos', 'e-mails', 'histórico de navegação', 'teclado', 'tela', 'localização'])
      assert.ok(texto.includes(naoColetado), `o texto não diz que não coleta "${naoColetado}"`);
    // Aprovado sem a frase sobre produtividade (decisão do Leo, 10/10/2026).
    assert.ok(!texto.includes('produtividade'), 'a frase sobre produtividade saiu do texto aprovado');
  });

  it('a versão em vigor é a do texto aprovado (2026-10-10), não a do rascunho publicado (2026-10-08)', () => {
    assert.equal(VERSAO_AVISO, '2026-10-10');
    assert.equal(AVISO_RASCUNHO, false);
  });
});

describe('POST /monitoramento/ciencia', () => {
  it('sem token: 401', async () => {
    const r = await chamar('POST', CIENCIA, { body: { versao: VERSAO_AVISO } });
    assert.equal(r.status, 401);
  });

  it('versão ausente, em outro tipo, objeto ou fora do formato: 400 VERSAO_INVALIDA', async () => {
    for (const body of [{}, { versao: '' }, { versao: 20261008 }, { versao: { $ne: 'x' } }, { versao: ['2026-10-08'] }, { versao: 'a b' }, { versao: 'x'.repeat(33) }])
      esperaErro(await chamar('POST', CIENCIA, { token: colaborador, body }), 400, 'VERSAO_INVALIDA');
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: 'u-002' } }), 0);
  });

  it('versão diferente da atual (texto mudou depois da leitura): 409 VERSAO_DESATUALIZADA, nada gravado', async () => {
    esperaErro(await chamar('POST', CIENCIA, { token: colaborador, body: { versao: '2026-01-01' } }), 409, 'VERSAO_DESATUALIZADA');
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: 'u-002' } }), 0);
  });

  it('Colaborador registra: 201 com quando e qual versão; grava quem, quando e a versão; audita uma vez', async () => {
    const antes = Date.now();
    const r = await chamar('POST', CIENCIA, { token: colaborador, body: { versao: VERSAO_AVISO } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.versao, VERSAO_AVISO);
    assert.equal(r.body.dados.nova, true);
    const quando = Date.parse(r.body.dados.registradaEm);
    assert.ok(quando >= antes - 1000 && quando <= Date.now() + 1000);

    const linhas = await prisma.monitoringAcknowledgement.findMany({ where: { userId: 'u-002' } });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].versao, VERSAO_AVISO);
    assert.equal(linhas[0].registradaEm.toISOString(), r.body.dados.registradaEm);

    const auditoria = await prisma.auditLog.findMany({ where: { acao: 'REGISTRAR_CIENCIA_MONITORAMENTO', usuarioId: 'u-002' } });
    assert.equal(auditoria.length, 1);
    assert.equal(auditoria[0].detalhe, `versao=${VERSAO_AVISO}`);
  });

  it('idempotente: a mesma versão de novo devolve 200 com a ciência original, sem linha nem auditoria nova', async () => {
    const original = await prisma.monitoringAcknowledgement.findUniqueOrThrow({
      where: { userId_versao: { userId: 'u-002', versao: VERSAO_AVISO } },
    });
    const r = await chamar('POST', CIENCIA, { token: colaborador, body: { versao: VERSAO_AVISO } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dados.nova, false);
    assert.equal(r.body.dados.registradaEm, original.registradaEm.toISOString());
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: 'u-002' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'REGISTRAR_CIENCIA_MONITORAMENTO', usuarioId: 'u-002' } }), 1);
  });

  it('depois da ciência, o aviso diz que ela está registrada e quando', async () => {
    const r = await chamar('GET', AVISO, { token: colaborador });
    assert.equal(r.body.dados.ciencia.registrada, true);
    const linha = await prisma.monitoringAcknowledgement.findFirstOrThrow({ where: { userId: 'u-002' } });
    assert.equal(r.body.dados.ciencia.registradaEm, linha.registradaEm.toISOString());
  });

  it('cliques simultâneos: uma ciência só, um 201, uma auditoria e nenhum 500', async () => {
    const u = await novoUsuario();
    const rs = await Promise.all(Array.from({ length: 6 }, () => chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 201]);
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: u.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'REGISTRAR_CIENCIA_MONITORAMENTO', usuarioId: u.id } }), 1);
  });

  it('ciência de uma versão antiga não vale para a atual', async () => {
    const u = await novoUsuario('Analista');
    // 2026-10-08: o rascunho publicado na demonstração antes da aprovação. Quem deu ciência dele
    // precisa ler o texto aprovado e registrar de novo.
    await prisma.monitoringAcknowledgement.create({ data: { userId: u.id, versao: '2026-10-08' } });
    const r = await chamar('GET', AVISO, { token: u.token });
    assert.deepEqual(r.body.dados.ciencia, { registrada: false, registradaEm: null });
    esperaErro(await chamar('POST', CIENCIA, { token: u.token, body: { versao: '2026-10-08' } }), 409, 'VERSAO_DESATUALIZADA');
    // A nova ciência convive com a antiga (histórico por versão).
    assert.equal((await chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } })).status, 201);
    const versoes = (await prisma.monitoringAcknowledgement.findMany({ where: { userId: u.id } })).map((c) => c.versao).sort();
    assert.deepEqual(versoes, ['2026-10-08', VERSAO_AVISO].sort());
  });

  it('o banco recusa versão fora do formato (CHECK) e a mesma versão duas vezes (único)', async () => {
    await assert.rejects(prisma.monitoringAcknowledgement.create({ data: { userId: 'u-001', versao: 'versão com espaço' } }));
    await prisma.monitoringAcknowledgement.create({ data: { userId: 'u-001', versao: 'teste-unico' } });
    await assert.rejects(prisma.monitoringAcknowledgement.create({ data: { userId: 'u-001', versao: 'teste-unico' } }));
    await prisma.monitoringAcknowledgement.deleteMany({ where: { userId: 'u-001', versao: 'teste-unico' } });
  });
});

describe('GET /monitoramento/ciencias (só Administrador)', () => {
  it('sem token 401; Analista e Colaborador 403 PERFIL_SEM_PERMISSAO', async () => {
    assert.equal((await chamar('GET', CIENCIAS)).status, 401);
    esperaErro(await chamar('GET', CIENCIAS, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', CIENCIAS, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('lista quem deu ciência de qual versão, mais recente primeiro, com o autor', async () => {
    const { dados, resumo } = await listar();
    assert.ok(dados.length >= 3);
    assert.equal(resumo.total, await prisma.monitoringAcknowledgement.count());
    assert.equal(resumo.versaoAtual, VERSAO_AVISO);
    const datas = dados.map((c) => Date.parse(c.registradaEm));
    assert.deepEqual(datas, [...datas].sort((a, b) => b - a));
    const colab = dados.find((c) => c.usuario.id === 'u-002');
    assert.ok(colab);
    assert.equal(colab.versao, VERSAO_AVISO);
    assert.deepEqual(colab.usuario, { id: 'u-002', nome: 'Colaborador', email: 'colaborador@empresa.com', perfil: 'Colaborador', status: 'Ativo' });
    assert.ok(dados.some((c) => c.versao === '2026-10-08'), 'a versão antiga também aparece');
    // Nada de dado sensível da conta na resposta.
    assert.doesNotMatch(JSON.stringify(dados), /senhaHash|\$2[aby]\$/);
  });

  it('filtra por versão e pagina no servidor sem repetir nem pular', async () => {
    const soAntiga = await listar('?versao=2026-10-08');
    assert.ok(soAntiga.dados.length >= 1);
    assert.ok(soAntiga.dados.every((c) => c.versao === '2026-10-08'));
    assert.equal(soAntiga.resumo.total, soAntiga.dados.length);

    const todos = await listar('?tamanho=100');
    const vistos: string[] = [];
    for (let pagina = 1; pagina <= todos.resumo.total; pagina++) {
      const p = await listar(`?pagina=${pagina}&tamanho=1`);
      assert.equal(p.resumo.pagina, pagina);
      assert.equal(p.resumo.tamanho, 1);
      vistos.push(...p.dados.map((c) => c.id));
    }
    assert.deepEqual(vistos, todos.dados.map((c) => c.id));
    assert.equal((await listar(`?pagina=${todos.resumo.total + 1}`)).dados.length, 0);
  });

  it('pendentesVersaoAtual conta só contas Ativo sem ciência da versão atual (Pendente não entra)', async () => {
    const antes = (await listar()).resumo.pendentesVersaoAtual;
    const esperado = await prisma.user.count({ where: { status: 'Ativo', ciencias: { none: { versao: VERSAO_AVISO } } } });
    assert.equal(antes, esperado);
    await criarUsuarioPendente(admin, 'Colaborador', 'b18pendente');
    assert.equal((await listar()).resumo.pendentesVersaoAtual, antes);
    const u = await novoUsuario();
    assert.equal((await listar()).resumo.pendentesVersaoAtual, antes + 1);
    await chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } });
    assert.equal((await listar()).resumo.pendentesVersaoAtual, antes);
  });

  it('parâmetro inválido: 400 com código próprio (inclusive objeto na query)', async () => {
    esperaErro(await chamar('GET', `${CIENCIAS}?pagina=0`, { token: admin }), 400, 'PAGINA_INVALIDA');
    esperaErro(await chamar('GET', `${CIENCIAS}?pagina=abc`, { token: admin }), 400, 'PAGINA_INVALIDA');
    esperaErro(await chamar('GET', `${CIENCIAS}?tamanho=101`, { token: admin }), 400, 'TAMANHO_INVALIDO');
    esperaErro(await chamar('GET', `${CIENCIAS}?versao[$ne]=x`, { token: admin }), 400, 'VERSAO_INVALIDA');
    esperaErro(await chamar('GET', `${CIENCIAS}?versao=a%20b`, { token: admin }), 400, 'VERSAO_INVALIDA');
    esperaErro(await chamar('GET', `${CIENCIAS}?versao=1&versao=2`, { token: admin }), 400, 'VERSAO_INVALIDA');
  });
});

describe('exclusão de usuário', () => {
  // Decisão do Leo (10/10/2026): a ciência é a prova de que a pessoa foi avisada, então a conta
  // que tem ciência não é excluída pela API (409 USUARIO_COM_CIENCIA); a saída é inativar. O
  // Cascade do schema continua só como rede de segurança para exclusão por SQL direto.
  it('conta com ciência registrada: 409 USUARIO_COM_CIENCIA, e a conta e a ciência ficam', async () => {
    const u = await novoUsuario();
    assert.equal((await chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } })).status, 201);
    const r = await chamar('DELETE', `/users/${u.id}`, { token: admin });
    esperaErro(r, 409, 'USUARIO_COM_CIENCIA');
    assert.equal(r.body.mensagem, 'Usuário com ciência registrada do aviso de monitoramento: inative a conta em vez de excluir');
    assert.ok(await prisma.user.findUnique({ where: { id: u.id } }));
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: u.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'EXCLUIR_USUARIO', detalhe: { startsWith: u.id } } }), 0);
  });

  it('ciência de uma versão antiga também impede a exclusão (qualquer versão é prova do aviso)', async () => {
    const u = await novoUsuario();
    await prisma.monitoringAcknowledgement.create({ data: { userId: u.id, versao: '2026-10-08' } });
    esperaErro(await chamar('DELETE', `/users/${u.id}`, { token: admin }), 409, 'USUARIO_COM_CIENCIA');
  });

  it('a conta com ciência pode ser inativada: perde o acesso e a ciência continua guardada', async () => {
    const u = await novoUsuario();
    assert.equal((await chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } })).status, 201);
    const r = await chamar('PATCH', `/users/${u.id}`, { token: admin, body: { status: 'Inativo' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dados.status, 'Inativo');
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: u.id } }), 1);
    esperaErro(await chamar('GET', AVISO, { token: u.token }), 401, 'USUARIO_INATIVO');
  });

  it('conta sem ciência continua podendo ser excluída', async () => {
    const u = await novoUsuario();
    const r = await chamar('DELETE', `/users/${u.id}`, { token: admin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await prisma.user.findUnique({ where: { id: u.id } }), null);
  });

  it('ciência gravada durante a exclusão entra na contagem (a conta é travada antes de contar)', async () => {
    const u = await novoUsuario();
    let exclusao: ReturnType<typeof chamar> | undefined;
    // A ciência fica gravada e ainda sem commit enquanto o DELETE chega: sem a trava da linha
    // do usuário, a contagem dava zero e a cascata apagava a ciência ao fim do DELETE.
    await prisma.$transaction(async (tx) => {
      await tx.monitoringAcknowledgement.create({ data: { userId: u.id, versao: VERSAO_AVISO } });
      exclusao = chamar('DELETE', `/users/${u.id}`, { token: admin });
      await new Promise((ok) => setTimeout(ok, 300));
    });
    esperaErro(await exclusao!, 409, 'USUARIO_COM_CIENCIA');
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: u.id } }), 1);
  });

  it('as regras anteriores vêm antes: histórico de campanha e conta inexistente mantêm a resposta', async () => {
    const outro = await novoUsuario('Colaborador');
    assert.equal((await chamar('POST', CIENCIA, { token: outro.token, body: { versao: VERSAO_AVISO } })).status, 201);
    const campanha = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Histórico e ciência', destinatario: outro.email, template: 'urgencia' },
    });
    assert.equal(campanha.status, 201, JSON.stringify(campanha.body));
    esperaErro(await chamar('DELETE', `/users/${outro.id}`, { token: admin }), 409, 'USUARIO_COM_HISTORICO');
    esperaErro(await chamar('DELETE', '/users/nao-existe', { token: admin }), 404, 'USUARIO_NAO_ENCONTRADO');
  });

  it('por SQL direto, fora da API, o Cascade do banco ainda leva as ciências (rede de segurança)', async () => {
    const u = await novoUsuario();
    assert.equal((await chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } })).status, 201);
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${u.id}`;
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: u.id } }), 0);
    // O registro da auditoria (sem FK) continua.
    assert.equal(await prisma.auditLog.count({ where: { acao: 'REGISTRAR_CIENCIA_MONITORAMENTO', usuarioId: u.id } }), 1);
  });
});

// ---- O aviso e o código não podem divergir --------------------------------------------
// O aviso diz que o agente coleta só programas instalados, sistema operacional e portas
// abertas (com o nome do processo). Este teste lê a configuração que o servidor entrega ao
// osquery e falha se aparecer qualquer tabela fora da lista abaixo. A lista é deste teste de
// propósito (não vem do código): incluir uma consulta nova exige mudar o teste E o aviso.

/** Tabelas do osquery que o aviso cobre. */
const TABELAS_PERMITIDAS = new Set(['programs', 'deb_packages', 'rpm_packages', 'apps', 'os_version', 'listening_ports', 'processes']);
/** De `processes` só sai o nome do processo dono da porta (pid só para ligar as tabelas). */
const COLUNAS_PROCESSES = { selecionadas: new Set(['name']), ligacao: new Set(['pid']) };
const OPCOES_PERMITIDAS = new Set(['schedule_splay_percent']);
const CHAVES_QUERY = new Set(['query', 'interval', 'snapshot', 'platform']);

/** Tabelas (com o apelido) depois de FROM/JOIN. Recusa junção por vírgula, que esconderia tabelas. */
function tabelasDaQuery(sql: string): { tabela: string; apelido: string | null }[] {
  const s = sql.toLowerCase().replace(/'[^']*'/g, "''");
  assert.doesNotMatch(s, /\b(from|join)\s+\w+(\s+(as\s+)?\w+)?\s*,/, `junção por vírgula não é aceita: ${sql}`);
  const fim = /^(on|where|left|right|inner|outer|cross|join|group|order|limit|union|natural|using)$/;
  const tabelas: { tabela: string; apelido: string | null }[] = [];
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/g)) {
    tabelas.push({ tabela: m[1], apelido: m[2] && !fim.test(m[2]) ? m[2] : null });
  }
  return tabelas;
}

describe('a coleta se limita a programas, sistema e portas (o aviso e o código não divergem)', () => {
  let config: Record<string, any>;

  before(async () => {
    const inscricao = await chamar('POST', '/agentes/osquery/enroll', {
      body: { enroll_secret: SEGREDO, host_identifier: 'b18-estacao-aviso', host_details: { system_info: { hostname: 'b18-aviso' } } },
    });
    assert.equal(inscricao.status, 200, JSON.stringify(inscricao.body));
    const r = await chamar('POST', '/agentes/osquery/config', { body: { node_key: inscricao.body.node_key } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    config = r.body;
  });

  it('só agenda queries (sem packs, file_paths, decorators, events, yara...) e só a opção de espalhar a execução', () => {
    assert.deepEqual(Object.keys(config).sort(), ['node_invalid', 'options', 'schedule']);
    for (const opcao of Object.keys(config.options)) assert.ok(OPCOES_PERMITIDAS.has(opcao), `opção não coberta pelo aviso: ${opcao}`);
    assert.ok(Object.keys(config.schedule).length > 0);
    for (const [nome, q] of Object.entries<Record<string, unknown>>(config.schedule))
      for (const chave of Object.keys(q)) assert.ok(CHAVES_QUERY.has(chave), `${nome}: chave inesperada ${chave}`);
  });

  it('toda query lê só tabelas permitidas e nunca SELECT *', () => {
    const usadas = new Set<string>();
    for (const [nome, { query }] of Object.entries<{ query: string }>(config.schedule)) {
      assert.doesNotMatch(query, /\*/, `${nome}: SELECT * coletaria colunas que o aviso não cita`);
      const tabelas = tabelasDaQuery(query);
      assert.ok(tabelas.length > 0, `${nome}: nenhuma tabela reconhecida em ${query}`);
      for (const { tabela } of tabelas) {
        assert.ok(TABELAS_PERMITIDAS.has(tabela), `${nome}: a tabela "${tabela}" não está no aviso de monitoramento`);
        usadas.add(tabela);
      }
    }
    // As três categorias do aviso estão de fato na configuração.
    assert.ok(['programs', 'deb_packages', 'rpm_packages', 'apps'].some((t) => usadas.has(t)));
    assert.ok(usadas.has('os_version'));
    assert.ok(usadas.has('listening_ports'));
  });

  it('de processes sai só o nome do processo da porta (pid só na ligação, todas as colunas qualificadas)', () => {
    for (const [nome, { query }] of Object.entries<{ query: string }>(config.schedule)) {
      const tabelas = tabelasDaQuery(query);
      const processes = tabelas.find((t) => t.tabela === 'processes');
      if (!processes) continue;
      assert.ok(tabelas.some((t) => t.tabela === 'listening_ports'), `${nome}: processes só junto das portas`);
      assert.ok(processes.apelido, `${nome}: processes precisa de apelido para conferir as colunas`);
      const s = query.toLowerCase();
      const lista = s.slice(s.indexOf('select') + 'select'.length, s.indexOf(' from ')).replace(/^\s*distinct\s+/, '');
      for (const item of lista.split(',').map((i) => i.trim())) {
        const m = item.match(/^([a-z_]+)\.([a-z_]+)(\s+as\s+[a-z_]+)?$/);
        assert.ok(m, `${nome}: coluna sem tabela na consulta com processes: "${item}"`);
        if (m[1] === processes.apelido) assert.ok(COLUNAS_PROCESSES.selecionadas.has(m[2]), `${nome}: processes.${m[2]} não está no aviso`);
      }
      for (const m of s.matchAll(new RegExp(`\\b${processes.apelido}\\.([a-z_]+)`, 'g')))
        assert.ok(COLUNAS_PROCESSES.selecionadas.has(m[1]) || COLUNAS_PROCESSES.ligacao.has(m[1]), `${nome}: processes.${m[1]}`);
    }
  });

  it('a frequência do aviso é a da configuração entregue em produção (B08: portas, programas e sistema)', async () => {
    const ambiente = { NODE_ENV: process.env.NODE_ENV, OSQUERY_INTERVALO_S: process.env.OSQUERY_INTERVALO_S };
    process.env.NODE_ENV = 'production';
    delete process.env.OSQUERY_INTERVALO_S;
    try {
      const inscricao = await chamar('POST', '/agentes/osquery/enroll', {
        body: { enroll_secret: SEGREDO, host_identifier: 'b18-estacao-frequencia', host_details: {} },
      });
      const r = await chamar('POST', '/agentes/osquery/config', { body: { node_key: inscricao.body.node_key } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const porCategoria = new Map<string, Set<number>>();
      for (const [nome, q] of Object.entries<{ interval: number }>(r.body.schedule)) {
        const categoria = QUERIES[nome].categoria;
        porCategoria.set(categoria, (porCategoria.get(categoria) ?? new Set()).add(q.interval));
      }
      const frase = (categoria: string) => {
        const intervalos = [...(porCategoria.get(categoria) ?? [])];
        assert.equal(intervalos.length, 1, `${categoria}: um intervalo só por categoria`);
        return duracaoPorExtenso(intervalos[0]);
      };
      const intro = TEXTO_AVISO.introducao;
      assert.ok(intro.includes(`as portas de rede abertas a cada ${frase('portas')}`), intro);
      assert.ok(intro.includes(`a lista de programas instalados a cada ${frase('programas')}`), intro);
      assert.ok(intro.includes(`a versão do sistema operacional a cada ${frase('sistema')}`), intro);
      // Os valores de hoje (B08), para o texto não mudar sem ninguém perceber.
      assert.deepEqual([frase('portas'), frase('programas'), frase('sistema')], ['15 minutos', '1 hora', '6 horas']);
    } finally {
      process.env.NODE_ENV = ambiente.NODE_ENV;
      if (ambiente.OSQUERY_INTERVALO_S !== undefined) process.env.OSQUERY_INTERVALO_S = ambiente.OSQUERY_INTERVALO_S;
    }
  });

  it('o servidor não tem consulta sob demanda (distributed): nada além da configuração agendada chega ao agente', async () => {
    for (const rota of ['/agentes/osquery/distributed_read', '/agentes/osquery/distributed/read', '/agentes/osquery/carve'])
      assert.equal((await chamar('POST', rota, { body: {} })).status, 404, rota);
  });

  it('o conferidor pega o que deveria pegar (tabela fora da lista, vírgula, coluna do processo)', () => {
    assert.deepEqual(tabelasDaQuery('SELECT path FROM file WHERE 1'), [{ tabela: 'file', apelido: null }]);
    assert.deepEqual(
      tabelasDaQuery('SELECT lp.port, p.cmdline FROM listening_ports lp LEFT JOIN processes AS p ON p.pid = lp.pid'),
      [
        { tabela: 'listening_ports', apelido: 'lp' },
        { tabela: 'processes', apelido: 'p' },
      ],
    );
    assert.throws(() => tabelasDaQuery('SELECT name FROM programs, users'));
    assert.deepEqual(tabelasDaQuery("SELECT name FROM (SELECT name FROM chrome_extensions) WHERE name = 'from x'").map((t) => t.tabela), [
      'chrome_extensions',
    ]);
  });
});

describe('cópia do texto no mock do frontend', () => {
  // O texto mora no model do backend (com a frequência calculada); o mock do frontend guarda
  // uma cópia literal para a demonstração sem API. Mudou o texto, este teste falha até a cópia
  // (baluarte-frontend/src/mocks/data.ts, MOCK_MONITORING_NOTICE) ser atualizada.
  const arquivo = new URL('../../baluarte-frontend/src/mocks/data.ts', import.meta.url);

  it('é igual ao texto servido pela API, na mesma ordem, com a mesma versão e o mesmo rascunho', { skip: !existsSync(arquivo) }, () => {
    const fonte = readFileSync(arquivo, 'utf8');
    const inicio = fonte.indexOf('export const MOCK_MONITORING_NOTICE');
    assert.ok(inicio >= 0, 'MOCK_MONITORING_NOTICE não encontrado');
    const corpo = fonte.slice(fonte.indexOf('= {', inicio), fonte.indexOf('\n};', inicio));
    assert.match(corpo, new RegExp(`draft: ${AVISO_RASCUNHO},`));
    const textos = Array.from(corpo.matchAll(/'([^']*)'/g), (m) => m[1]);
    const esperado = [
      VERSAO_AVISO,
      TEXTO_AVISO.titulo,
      TEXTO_AVISO.introducao,
      ...TEXTO_AVISO.secoes.flatMap((sec) => [sec.id, sec.titulo, ...sec.paragrafos, ...sec.itens, ...sec.observacoes]),
    ];
    assert.deepEqual(textos, esperado);
  });
});

describe('duracaoPorExtenso', () => {
  it('escreve horas, minutos e segundos no singular e no plural', () => {
    assert.equal(duracaoPorExtenso(3600), '1 hora');
    assert.equal(duracaoPorExtenso(21600), '6 horas');
    assert.equal(duracaoPorExtenso(900), '15 minutos');
    assert.equal(duracaoPorExtenso(60), '1 minuto');
    assert.equal(duracaoPorExtenso(75), '75 segundos');
  });
});
