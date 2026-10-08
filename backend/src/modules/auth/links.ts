import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../platform/db.js';
import { enviarEmail, urlFrontend } from '../../platform/email.js';
import { gerarTokenLink, hashToken } from '../../platform/tokens.js';

// Links de conta entregues por e-mail. CONVITE: quem o administrador cadastra nasce
// Pendente, sem senha utilizavel, e cria a propria senha pelo link (nao existe senha
// provisoria). RESET: "esqueci minha senha". Os dois sao de uso unico e terminam no
// mesmo endpoint (POST /auth/reset-password/confirm).

export type TipoLink = 'RESET' | 'CONVITE';

export const VALIDADE_LINK_MS: Record<TipoLink, number> = {
  RESET: 30 * 60 * 1000,
  CONVITE: 72 * 60 * 60 * 1000,
};

/**
 * Hash para a coluna senhaHash de quem ainda nao criou a senha: bcrypt de 32 bytes
 * aleatorios descartados na hora. Nenhuma senha digitada confere com ele.
 */
export function hashSemSenha(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), 10);
}

interface Destinatario {
  id: string;
  nome: string;
  email: string;
}

function mensagem(tipo: TipoLink, nome: string, link: string) {
  if (tipo === 'CONVITE') {
    return {
      assunto: 'Baluarte: crie sua senha de acesso',
      texto:
        `Olá, ${nome}.\n\n` +
        'Uma conta foi criada para você na plataforma Baluarte. Para ativá-la, crie sua senha ' +
        `pelo link abaixo (válido por 72 horas e de uso único):\n\n${link}\n\n` +
        'Se você não esperava este convite, ignore este e-mail.',
    };
  }
  return {
    assunto: 'Baluarte: redefinição de senha',
    texto:
      `Olá, ${nome}.\n\n` +
      'Recebemos um pedido para redefinir a sua senha. Para criar uma nova, use o link abaixo ' +
      `(válido por 30 minutos e de uso único):\n\n${link}\n\n` +
      'Se não foi você que pediu, ignore este e-mail: a sua senha atual continua valendo.',
  };
}

/**
 * Gera um link de conta, grava so o hash do token e envia o e-mail. Um convite novo
 * invalida os convites anteriores da mesma pessoa. Devolve se o e-mail saiu.
 */
export async function emitirLinkConta(usuario: Destinatario, tipo: TipoLink): Promise<boolean> {
  const token = gerarTokenLink();
  await prisma.$transaction([
    ...(tipo === 'CONVITE'
      ? [prisma.passwordResetToken.deleteMany({ where: { userId: usuario.id, tipo: 'CONVITE', usadoEm: null } })]
      : []),
    prisma.passwordResetToken.create({
      data: {
        userId: usuario.id,
        tipo,
        tokenHash: hashToken(token),
        expiraEm: new Date(Date.now() + VALIDADE_LINK_MS[tipo]),
      },
    }),
  ]);
  const rota = tipo === 'CONVITE' ? 'definir-senha' : 'reset-password';
  const { assunto, texto } = mensagem(tipo, usuario.nome, `${urlFrontend()}/${rota}?token=${token}`);
  return enviarEmail({ para: usuario.email, assunto, texto });
}

/** Token de link valido (existe, nao usado, nao expirado, conta nao inativa), com o dono. */
export async function localizarLinkValido(token: string) {
  const registro = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token.trim()) },
    include: { user: true },
  });
  if (!registro || registro.usadoEm || registro.expiraEm.getTime() < Date.now()) return null;
  if (registro.user.status === 'Inativo') return null;
  return registro;
}
