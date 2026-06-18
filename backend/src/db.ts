import { PrismaClient } from '@prisma/client';

// Cliente Prisma compartilhado (singleton) para toda a aplicacao.
export const prisma = new PrismaClient();
