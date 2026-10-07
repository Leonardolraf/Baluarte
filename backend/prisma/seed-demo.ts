import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';
import { dadosAchado, type ChaveAchado } from '../src/catalogo.js';
import { gerarTokenLink, hashToken } from '../src/tokens.js';

// Popula o banco com dados de DEMONSTRACAO para o frontend ter conteudo realista.
// Roda DEPOIS do seed de contrato. NAO deve rodar antes do Newman (use db:reset + seed).
async function main() {
  // limpa dados gerados (mantem usuarios/ativos de contrato u-000/u-001/u-002/ativo-001/ativo-002)
  await prisma.finding.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.campaignEvent.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.user.deleteMany({ where: { id: { notIn: ['u-000', 'u-001', 'u-002'] } } });
  await prisma.asset.deleteMany({ where: { id: { notIn: ['ativo-001', 'ativo-002'] } } });

  // ---- Ativos extras ----
  const ativos = [
    { id: 'ativo-003', nome: 'Portal do Cliente', host: 'portal.empresa.com', tipo: 'Aplicacao', status: 'Ativo' },
    { id: 'ativo-004', nome: 'API de Pagamentos', host: 'api.empresa.com', tipo: 'Aplicacao', status: 'Ativo' },
    { id: 'ativo-005', nome: 'Banco de Dados Central', host: 'db.empresa.com', tipo: 'Banco de Dados', status: 'Ativo' },
  ];
  for (const a of ativos) await prisma.asset.create({ data: a });

  // ---- Varreduras + achados (classificacao, nota e remediacao vem do catalogo) ----
  const achados: Record<string, [ChaveAchado, string][]> = {
    'ativo-003': [['injecao-sql', 'Aberta'], ['idor', 'Em revisão'], ['sem-bloqueio-login', 'Aberta']],
    'ativo-004': [['sessao-sem-expiracao', 'Em remediação'], ['cors-curinga', 'Aberta']],
    'ativo-001': [['componente-vulneravel', 'Resolvida'], ['injecao-comando', 'Aberta']],
  };
  for (const [assetId, lista] of Object.entries(achados)) {
    const scan = await prisma.scan.create({ data: { assetId, status: 'CONCLUIDA', concluidoEm: new Date() } });
    for (const [chave, status] of lista) {
      await prisma.finding.create({ data: { ...dadosAchado(chave), scanId: scan.id, status } });
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
