import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/db.js';
import { dadosAchado, type ChaveAchado } from '../src/models/catalogoAchado.model.js';
import { gerarTokenLink, hashToken } from '../src/utils/tokens.js';

// Popula o banco com dados de DEMONSTRACAO para o frontend ter conteudo realista.
// Roda DEPOIS do seed de contrato. NAO deve rodar antes do Newman (use db:reset + seed).

/** Instante de `dias` dias atras (mesma hora de agora). */
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

async function main() {
  // limpa dados gerados (mantem usuarios/ativos de contrato u-000/u-001/u-002/ativo-001/ativo-002)
  await prisma.finding.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.campaignEvent.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.user.deleteMany({ where: { id: { notIn: ['u-000', 'u-001', 'u-002'] } } });
  await prisma.asset.deleteMany({ where: { id: { notIn: ['ativo-001', 'ativo-002'] } } });

  // ---- Ativos extras ----
  // Datados no passado (os de contrato tambem), para a evolucao do risco em 30 dias (B25b) ter
  // os ativos ja existentes em todos os dias da janela (sao a capacidade do indice).
  const desde = diasAtras(60);
  const ativos = [
    { id: 'ativo-003', nome: 'Portal do Cliente', host: 'portal.empresa.com', tipo: 'Aplicacao', status: 'Ativo' },
    { id: 'ativo-004', nome: 'API de Pagamentos', host: 'api.empresa.com', tipo: 'Aplicacao', status: 'Ativo' },
    { id: 'ativo-005', nome: 'Banco de Dados Central', host: 'db.empresa.com', tipo: 'Banco de Dados', status: 'Ativo' },
  ];
  for (const a of ativos) await prisma.asset.create({ data: { ...a, criadoEm: desde } });
  await prisma.asset.updateMany({ where: { id: { in: ['ativo-001', 'ativo-002'] } }, data: { criadoEm: desde } });

  // ---- Varreduras + achados (classificacao, nota e remediacao vem do catalogo) ----
  // Cada achado nasce "Aberta" ha N dias e muda de status em datas passadas, gravando o
  // historico como a API grava (B25b: evento de criacao + um evento por mudanca, com autor).
  // Assim a aba de historico fica completa e a evolucao do risco tem subidas e descidas.
  type Mudanca = [diasAtras: number, status: string];
  const achados: Record<string, Array<[ChaveAchado, number, Mudanca[]]>> = {
    'ativo-003': [
      ['injecao-sql', 25, []],
      ['idor', 18, [[6, 'Em revisão']]],
      ['sem-bloqueio-login', 12, []],
    ],
    'ativo-004': [
      ['sessao-sem-expiracao', 20, [[15, 'Em revisão'], [7, 'Em remediação']]],
      ['cors-curinga', 9, []],
    ],
    'ativo-001': [
      ['componente-vulneravel', 28, [[20, 'Em remediação'], [4, 'Resolvida']]],
      ['injecao-comando', 3, []],
    ],
    'ativo-005': [['cookie-inseguro', 14, [[10, 'Risco aceito']]]],
  };
  for (const [assetId, lista] of Object.entries(achados)) {
    const inicio = diasAtras(Math.max(...lista.map(([, dias]) => dias)));
    const scan = await prisma.scan.create({ data: { assetId, status: 'CONCLUIDA', criadoEm: inicio, concluidoEm: inicio } });
    for (const [chave, dias, mudancas] of lista) {
      const criadoEm = diasAtras(dias);
      const status = mudancas.length ? mudancas[mudancas.length - 1][1] : 'Aberta';
      const f = await prisma.finding.create({ data: { ...dadosAchado(chave), scanId: scan.id, status, criadoEm } });
      let de = 'Aberta';
      await prisma.findingStatusChange.create({ data: { findingId: f.id, de: null, para: de, registradaEm: criadoEm } });
      for (const [quando, para] of mudancas) {
        await prisma.findingStatusChange.create({ data: { findingId: f.id, de, para, usuarioId: 'u-001', registradaEm: diasAtras(quando) } });
        de = para;
      }
    }
  }

  // ---- Usuarios extras (RBAC) ----
  const senha = await bcrypt.hash('Mudar@123', 10);
  // Departamentos vem do seed de contrato (rodado antes deste).
  const deps = new Map((await prisma.department.findMany()).map((d) => [d.name, d.id]));
  const dep = (nome: string) => {
    const id = deps.get(nome);
    if (!id) throw new Error(`departamento ausente: ${nome} (rode o seed antes do seed:demo)`);
    return id;
  };
  const usuarios = [
    { nome: 'Edson Marcelino', email: 'edson@empresa.com', perfil: 'Analista', status: 'Ativo', departmentId: dep('TI') },
    { nome: 'Ana Souza', email: 'ana.souza@empresa.com', perfil: 'Colaborador', status: 'Ativo', departmentId: dep('Financeiro') },
    { nome: 'Bruno Lima', email: 'bruno.lima@empresa.com', perfil: 'Colaborador', status: 'Ativo', departmentId: dep('Comercial') },
    { nome: 'Carla Dias', email: 'carla.dias@empresa.com', perfil: 'Colaborador', status: 'Inativo', departmentId: dep('RH') },
  ];
  for (const u of usuarios) await prisma.user.create({ data: { ...u, senhaHash: senha } });

  // ---- Colaboradores-alvo das campanhas (campanha so aceita usuario cadastrado) ----
  const TOTAL_COLABS = 203; // maior campanha abaixo
  // Distribuicao realista: mais gente em Comercial/Operacoes, pouca na Diretoria.
  const ROTACAO = ['Comercial', 'Operações', 'Comercial', 'Financeiro', 'Operações', 'TI', 'RH', 'Comercial', 'Operações', 'Diretoria'];
  await prisma.user.createMany({
    data: Array.from({ length: TOTAL_COLABS }, (_, i) => ({
      nome: `Colaborador ${i + 1}`,
      email: `colab${i}@empresa.com`,
      perfil: 'Colaborador',
      status: 'Ativo',
      senhaHash: senha,
      departmentId: dep(ROTACAO[i % ROTACAO.length]),
    })),
  });
  const colabs = await prisma.user.findMany({ where: { email: { startsWith: 'colab', endsWith: '@empresa.com' }, perfil: 'Colaborador', id: { not: 'u-002' } } });
  const idPorEmail = new Map(colabs.map((u) => [u.email, u.id]));

  // ---- Campanhas + eventos (funil) ----
  async function campanha(nome: string, template: string, status: string, total: number, abertos: number, clicados: number, submeteram: number, reportaram: number) {
    const c = await prisma.campaign.create({ data: { nome, template, status } });
    for (let i = 0; i < total; i++) {
      await prisma.campaignEvent.create({
        data: {
          campaignId: c.id,
          userId: idPorEmail.get(`colab${i}@empresa.com`)!,
          destinatario: `colab${i}@empresa.com`,
          tokenHash: hashToken(gerarTokenLink()), // demo: o token em claro e descartado
          enviadoEm: new Date(),
          abertoEm: i < abertos ? new Date() : null,
          clicadoEm: i < clicados ? new Date() : null,
          submeteuEm: i < submeteram ? new Date() : null,
          reportouEm: i < reportaram ? new Date() : null,
          treinou: i < clicados,
          treinouEm: i < clicados ? new Date() : null,
        },
      });
    }
    return c;
  }
  await campanha('Campanha Junho 2026', 'urgencia', 'ATIVA', 156, 112, 59, 28, 13);
  await campanha('Simulacao Credencial Maio', 'autoridade', 'ENCERRADA', 203, 150, 45, 20, 30);
  await campanha('Fake Invoice Julho', 'curiosidade', 'AGENDADA', 180, 0, 0, 0, 0);

  const nF = await prisma.finding.count();
  const nC = await prisma.campaign.count();
  const nU = await prisma.user.count();
  console.log(`[seed:demo] ${nF} findings, ${nC} campanhas, ${nU} usuarios.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
