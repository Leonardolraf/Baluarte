import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { enviarEmail, urlFrontend } from '../config/email.js';
import type { TipoLink } from '../models/auth.model.js';
import { buscarLinkPorHash, gravarLinkConta } from '../repositories/auth.repository.js';
import { gerarTokenLink, hashToken } from '../utils/tokens.js';
import { dataHora } from './relatorioVulnerabilidade.service.js';

// Links de conta entregues por e-mail. CONVITE: quem o administrador cadastra nasce
// Pendente, sem senha utilizavel, e cria a propria senha pelo link (nao existe senha
// provisoria). RESET: "esqueci minha senha". Os dois sao de uso unico e terminam no
// mesmo endpoint (POST /auth/reset-password/confirm).
// Aqui tambem fica o aviso "sua senha foi alterada" (#4), que sai pelo mesmo envio
// (config/email.ts) mas nao leva link nem credencial.

export type { TipoLink };

// Validades (Melhorias #20 e #21, 13/10/2026): convite 24 h (antes 72 h), redefinicao
// 10 min (antes 30 min). O texto do e-mail sai destas constantes, nunca de numero repetido.
export const VALIDADE_LINK_MS: Record<TipoLink, number> = {
  RESET: 10 * 60 * 1000,
  CONVITE: 24 * 60 * 60 * 1000,
};

/** Validade em texto para o e-mail: "24 horas", "10 minutos". */
export function validadeEmTexto(ms: number): string {
  const minutos = Math.round(ms / 60000);
  if (minutos % 60 === 0) {
    const horas = minutos / 60;
    return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  }
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
}

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
        `pelo link abaixo (válido por ${validadeEmTexto(VALIDADE_LINK_MS.CONVITE)} e de uso único):\n\n${link}\n\n` +
        'Se você não esperava este convite, ignore este e-mail.',
    };
  }
  return {
    assunto: 'Baluarte: redefinição de senha',
    texto:
      `Olá, ${nome}.\n\n` +
      'Recebemos um pedido para redefinir a sua senha. Para criar uma nova, use o link abaixo ' +
      `(válido por ${validadeEmTexto(VALIDADE_LINK_MS.RESET)} e de uso único):\n\n${link}\n\n` +
      'Se não foi você que pediu, ignore este e-mail: a sua senha atual continua valendo.',
  };
}

/**
 * Gera um link de conta, grava so o hash do token e envia o e-mail. Um convite novo
 * invalida os convites anteriores da mesma pessoa. Devolve se o e-mail saiu.
 */
export async function emitirLinkConta(usuario: Destinatario, tipo: TipoLink): Promise<boolean> {
  const token = gerarTokenLink();
  await gravarLinkConta({
    userId: usuario.id,
    tipo,
    tokenHash: hashToken(token),
    expiraEm: new Date(Date.now() + VALIDADE_LINK_MS[tipo]),
  });
  const rota = tipo === 'CONVITE' ? 'definir-senha' : 'reset-password';
  const { assunto, texto } = mensagem(tipo, usuario.nome, `${urlFrontend()}/${rota}?token=${token}`);
  return enviarEmail({ para: usuario.email, assunto, texto });
}

/** Token de link valido (existe, nao usado, nao expirado, conta nao inativa), com o dono. */
export async function localizarLinkValido(token: string) {
  const registro = await buscarLinkPorHash(hashToken(token.trim()));
  if (!registro || registro.usadoEm || registro.expiraEm.getTime() < Date.now()) return null;
  if (registro.user.status === 'Inativo') return null;
  return registro;
}

/** Texto do aviso de senha alterada: quando foi e o que fazer se nao foi a pessoa. Sem link. */
export function mensagemSenhaAlterada(nome: string, quando: Date) {
  return {
    assunto: 'Baluarte: sua senha foi alterada',
    texto:
      `Olá, ${nome}.\n\n` +
      `A senha da sua conta na plataforma Baluarte foi alterada em ${dataHora(quando)} (horário de Brasília).\n\n` +
      'Se foi você, nenhuma ação é necessária.\n\n' +
      'Se não foi você, procure o administrador da plataforma imediatamente: alguém pode ter ' +
      'acesso à sua conta.',
  };
}

/**
 * Avisa o dono da conta que a senha mudou (troca logada ou redefinicao pelo link). Nunca lanca:
 * a senha ja foi trocada, e uma falha no envio nao pode desfazer nem derrubar a troca.
 * Devolve se o e-mail saiu.
 */
export async function avisarSenhaAlterada(usuario: Destinatario, quando: Date = new Date()): Promise<boolean> {
  try {
    const { assunto, texto } = mensagemSenhaAlterada(usuario.nome, quando);
    return await enviarEmail({ para: usuario.email, assunto, texto });
  } catch (e) {
    console.error('[e-mail] falha ao avisar a troca de senha', e instanceof Error ? e.message : e);
    return false;
  }
}
