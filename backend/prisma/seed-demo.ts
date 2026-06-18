import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';
import { faixaCvss } from '../src/util.js';

// Popula o banco com dados de DEMONSTRACAO para o frontend ter conteudo realista.
// Roda DEPOIS do seed de contrato. NAO deve rodar antes do Newman (use db:reset + seed).
async function main() {
  // limpa dados gerados (mantem usuarios/ativos de contrato u-000/u-001/ativo-001/ativo-002)
  await prisma.finding.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.campaignEvent.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.user.deleteMany({ where: { id: { notIn: ['u-000', 'u-001'] } } });
  await prisma.asset.deleteMany({ where: { id: { notIn: ['ativo-001', 'ativo-002'] } } });

  // ---- Ativos extras ----
  const ativos = [
    { id: 'ativo-003', nome: 'Portal do Cliente', host: 'portal.empresa.com', tipo: 'Aplicacao', status: 'Ativo' },
    { id: 'ativo-004', nome: 'API de Pagamentos', host: 'api.empresa.com', tipo: 'Aplicacao', status: 'Ativo' },
    { id: 'ativo-005', nome: 'Banco de Dados Central', host: 'db.empresa.com', tipo: 'Banco de Dados', status: 'Ativo' },
  ];
  for (const a of ativos) await prisma.asset.create({ data: a });

  // ---- Varreduras + achados ----
  const achados: Record<string, { cat: string; cvss: number; desc: string; ev: string; status: string }[]> = {
    'ativo-003': [
      { cat: 'A03:2021 - Injection', cvss: 9.8, desc: 'Injecao SQL no campo de busca.', ev: "GET /busca?q=' OR '1'='1", status: 'Aberta' },
      { cat: 'A01:2021 - Broken Access Control', cvss: 8.2, desc: 'IDOR no perfil de usuario.', ev: 'GET /api/users/2 com token de outro usuario', status: 'Em revisão' },
      { cat: 'A07:2021 - Identification and Authentication Failures', cvss: 7.4, desc: 'Sem bloqueio por tentativas.', ev: '200 logins/min sem rate limit', status: 'Aberta' },
    ],
    'ativo-004': [
      { cat: 'A02:2021 - Cryptographic Failures', cvss: 6.5, desc: 'Token JWT sem expiracao.', ev: 'exp ausente no payload', status: 'Em remediação' },
      { cat: 'A05:2021 - Security Misconfiguration', cvss: 5.3, desc: 'CORS liberado para *.', ev: 'Access-Control-Allow-Origin: *', status: 'Aberta' },
    ],
    'ativo-001': [
      { cat: 'A06:2021 - Vulnerable and Outdated Components', cvss: 4.2, desc: 'Dependencia com CVE conhecido.', ev: 'lodash@4.17.11 (CVE-2019-10744)', status: 'Resolvida' },
      { cat: 'A03:2021 - Injection', cvss: 9.1, desc: 'Command injection no upload.', ev: 'filename=; rm -rf', status: 'Aberta' },
    ],
  };
  for (const [assetId, lista] of Object.entries(achados)) {
    const scan = await prisma.scan.create({ data: { assetId, status: 'CONCLUIDA', concluidoEm: new Date() } });
    for (const f of lista) {
      await prisma.finding.create({ data: { scanId: scan.id, categoriaOwasp: f.cat, cvss: f.cvss, severidade: faixaCvss(f.cvss), descricao: f.desc, evidencia: f.ev, status: f.status } });
    }
  }

  // ---- Usuarios extras (RBAC) ----
  const senha = await bcrypt.hash('Mudar@123', 10);
  const usuarios = [
    { nome: 'Edson Marcelino', email: 'edson@empresa.com', perfil: 'Analista', status: 'Ativo' },
    { nome: 'Ana Souza', email: 'ana.souza@empresa.com', perfil: 'Colaborador', status: 'Ativo' },
    { nome: 'Bruno Lima', email: 'bruno.lima@empresa.com', perfil: 'Colaborador', status: 'Ativo' },
    { nome: 'Carla Dias', email: 'carla.dias@empresa.com', perfil: 'Colaborador', status: 'Inativo' },
  ];
  for (const u of usuarios) await prisma.user.create({ data: { ...u, senhaHash: senha } });

  // ---- Campanhas + eventos (funil) ----
  async function campanha(nome: string, template: string, status: string, total: number, abertos: number, clicados: number, submeteram: number, reportaram: number) {
    const c = await prisma.campaign.create({ data: { nome, template, status } });
    for (let i = 0; i < total; i++) {
      await prisma.campaignEvent.create({
        data: {
          campaignId: c.id,
          destinatario: `colab${i}@empresa.com`,
          enviadoEm: new Date(),
          abertoEm: i < abertos ? new Date() : null,
          clicadoEm: i < clicados ? new Date() : null,
          submeteuEm: i < submeteram ? new Date() : null,
          reportouEm: i < reportaram ? new Date() : null,
          treinou: i < clicados,
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
