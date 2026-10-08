import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/db.js';

// Dados de seed — mesmos IDs/credenciais que o contrato dos testes da N2 AT1 assume:
//  - usuario analista@empresa.com / Senha@123  (login e dup de e-mail)
//  - colaborador@empresa.com / Colab@123  (destinatario das campanhas do Newman e do Robot:
//    campanha so aceita usuario cadastrado)
//  - ativo-001 host 192.168.0.10 (Ativo)  e  ativo-002 host 192.168.0.20 (Inativo)
//  - departamentos padrao (mesma lista que a tela de cadastro de usuario oferece)
export const DEPARTAMENTOS_PADRAO = ['Comercial', 'Diretoria', 'Financeiro', 'Operações', 'RH', 'TI'];

async function main() {
  const senhaAnalista = await bcrypt.hash('Senha@123', 10);
  const senhaAdmin = await bcrypt.hash('Admin@123', 10);
  const senhaColab = await bcrypt.hash('Colab@123', 10);

  await prisma.user.upsert({
    where: { email: 'analista@empresa.com' },
    update: {},
    create: { id: 'u-001', nome: 'Analista de Segurança', email: 'analista@empresa.com', senhaHash: senhaAnalista, perfil: 'Analista', status: 'Ativo' },
  });
  await prisma.user.upsert({
    where: { email: 'admin@empresa.com' },
    update: {},
    create: { id: 'u-000', nome: 'Administrador', email: 'admin@empresa.com', senhaHash: senhaAdmin, perfil: 'Administrador', status: 'Ativo' },
  });
  await prisma.user.upsert({
    where: { email: 'colaborador@empresa.com' },
    update: {},
    create: { id: 'u-002', nome: 'Colaborador', email: 'colaborador@empresa.com', senhaHash: senhaColab, perfil: 'Colaborador', status: 'Ativo' },
  });

  for (const name of DEPARTAMENTOS_PADRAO) {
    await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
  }

  await prisma.asset.upsert({
    where: { host: '192.168.0.10' },
    update: {},
    create: { id: 'ativo-001', nome: 'Servidor Web de Produção', host: '192.168.0.10', tipo: 'Servidor', status: 'Ativo' },
  });
  await prisma.asset.upsert({
    where: { host: '192.168.0.20' },
    update: {},
    create: { id: 'ativo-002', nome: 'Servidor Legado', host: '192.168.0.20', tipo: 'Servidor', status: 'Inativo' },
  });

  console.log('[seed] usuários, departamentos e ativos criados.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
