import nodemailer, { type Transporter } from 'nodemailer';

// Envio de e-mail da plataforma (convite, redefinicao de senha). Tres transportes:
//  - smtp:    SMTP_HOST definido. Em dev/demo e o Mailpit do Docker Compose (nada sai
//             da maquina); em producao, o servidor SMTP real.
//  - memoria: NODE_ENV=test. Os testes leem os e-mails em `caixaDeSaida`.
//  - console: sem SMTP fora de producao. Imprime o e-mail inteiro no log da API.
// Em producao sem SMTP nada e enviado nem impresso (o link nunca vai para o log).

export interface Email {
  para: string;
  assunto: string;
  texto: string;
}

type Transporte = 'smtp' | 'memoria' | 'console' | 'nenhum';

/** E-mails "enviados" pelo transporte em memoria (so em NODE_ENV=test). */
export const caixaDeSaida: Email[] = [];

function transporte(): Transporte {
  if (process.env.NODE_ENV === 'test') return 'memoria';
  if (process.env.SMTP_HOST) return 'smtp';
  return process.env.NODE_ENV === 'production' ? 'nenhum' : 'console';
}

let smtp: Transporter | null = null;
function clienteSmtp(): Transporter {
  if (!smtp) {
    const usuario = process.env.SMTP_USER;
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 1025),
      // 465 = TLS implicito; nas demais portas o nodemailer negocia STARTTLS quando o servidor oferece.
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: usuario ? { user: usuario, pass: process.env.SMTP_PASS ?? '' } : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }
  return smtp;
}

/**
 * Envia um e-mail. Devolve false (e registra no log) se nao foi possivel; nunca lanca,
 * para quem chama decidir se a falha muda a resposta.
 */
export async function enviarEmail(email: Email): Promise<boolean> {
  const modo = transporte();
  try {
    if (modo === 'memoria') {
      caixaDeSaida.push(email);
      return true;
    }
    if (modo === 'console') {
      console.log(`[e-mail] para ${email.para} — ${email.assunto}\n${email.texto}`);
      return true;
    }
    if (modo === 'nenhum') {
      console.error(`[e-mail] SMTP_HOST não configurado: "${email.assunto}" não foi enviado`);
      return false;
    }
    await clienteSmtp().sendMail({
      from: process.env.EMAIL_REMETENTE ?? 'Baluarte <nao-responda@baluarte.local>',
      to: email.para,
      subject: email.assunto,
      text: email.texto,
    });
    return true;
  } catch (e) {
    console.error(`[e-mail] falha ao enviar "${email.assunto}"`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Endereco do frontend usado nos links dos e-mails. */
export function urlFrontend(): string {
  return (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}
