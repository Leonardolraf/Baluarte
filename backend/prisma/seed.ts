import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';

// Dados de seed — mesmos IDs/credenciais que o contrato dos testes da N2 AT1 assume:
//  - usuario analista@empresa.com / Senha@123  (login e dup de e-mail)
//  - ativo-001 host 192.168.0.10 (Ativo)  e  ativo-002 host 192.168.0.20 (Inativo)
async function main() {
  const senhaAnalista = await bcrypt.hash('Senha@123', 10);
  const senhaAdmin = await bcrypt.hash('Admin@123', 10);

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

  console.log('[seed] usuários e ativos criados.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
