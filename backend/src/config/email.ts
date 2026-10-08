import nodemailer, { type Transporter } from 'nodemailer';

// Envio de e-mail da plataforma (convite, redefinicao de senha, e-mail simulado da campanha).
// Transportes, nesta ordem de escolha:
//  - memoria: NODE_ENV=test. Os testes leem os e-mails em `caixaDeSaida`.
//  - brevo:   BREVO_API_KEY definida. API HTTPS do Brevo; usado onde o provedor bloqueia
//             as portas de SMTP (Railway Hobby, Render gratis bloqueiam 25/465/587).
//  - smtp:    SMTP_HOST definido. Em dev e o Mailpit do Docker Compose (nada sai da
//             maquina); na Vercel, o SMTP do Gmail.
//  - console: nada configurado, fora de producao. Imprime o e-mail inteiro no log da API.
// Em producao sem transporte nada e enviado nem impresso (o link nunca vai para o log).

export interface Email {
  para: string;
  assunto: string;
  texto: string;
}

type Transporte = 'memoria' | 'brevo' | 'smtp' | 'console' | 'nenhum';

/** E-mails "enviados" pelo transporte em memoria (so em NODE_ENV=test). */
export const caixaDeSaida: Email[] = [];

function transporte(): Transporte {
  if (process.env.NODE_ENV === 'test') return 'memoria';
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SMTP_HOST) return 'smtp';
  return process.env.NODE_ENV === 'production' ? 'nenhum' : 'console';
}

const REMETENTE_PADRAO = 'Baluarte <nao-responda@baluarte.local>';

/** "Nome <email@dominio>" ou so "email@dominio" -> { name, email }. */
export function lerRemetente(valor: string): { name?: string; email: string } {
  const m = valor.match(/^\s*(.*?)\s*<\s*([^>\s]+)\s*>\s*$/);
  if (m) return m[1] ? { name: m[1].replace(/^"|"$/g, ''), email: m[2] } : { email: m[2] };
  return { email: valor.trim() };
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

/** Envio pela API transacional do Brevo (o remetente precisa estar verificado na conta). */
async function enviarPeloBrevo(email: Email, remetente: string): Promise<void> {
  const resposta = await fetch(process.env.BREVO_API_URL ?? 'https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: lerRemetente(remetente),
      to: [{ email: email.para }],
      subject: email.assunto,
      textContent: email.texto,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resposta.ok) {
    // So o status e o codigo do Brevo vao para o log (nunca a chave nem o corpo do e-mail).
    const detalhe = await resposta.json().catch(() => ({}));
    throw new Error(`Brevo respondeu ${resposta.status} ${(detalhe as { code?: string }).code ?? ''}`.trim());
  }
}

/**
 * Envia um e-mail. Devolve false (e registra no log) se nao foi possivel; nunca lanca,
 * para quem chama decidir se a falha muda a resposta.
 */
export async function enviarEmail(email: Email): Promise<boolean> {
  const modo = transporte();
  const remetente = process.env.EMAIL_REMETENTE ?? REMETENTE_PADRAO;
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
      console.error(`[e-mail] nenhum transporte configurado (BREVO_API_KEY ou SMTP_HOST): "${email.assunto}" não foi enviado`);
      return false;
    }
    if (modo === 'brevo') {
      await enviarPeloBrevo(email, remetente);
      return true;
    }
    await clienteSmtp().sendMail({ from: remetente, to: email.para, subject: email.assunto, text: email.texto });
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
