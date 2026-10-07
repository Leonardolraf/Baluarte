import { prisma } from './db.js';
import { enviarEmail, urlFrontend, type Email } from './email.js';

// E-mail da campanha de phishing SIMULADO (treinamento interno). Regras:
//  - sai pelo mesmo canal dos e-mails de conta (src/email.ts): remetente da plataforma
//    (EMAIL_REMETENTE), Mailpit em dev/demo, caixa em memoria nos testes, nada em
//    producao sem SMTP;
//  - so texto: sem anexo, sem HTML (logo, sem pixel de abertura), sem formulario e sem
//    pedido de senha;
//  - os dois links apontam para o proprio frontend da plataforma (nenhum link externo):
//    /t/<token> abre o treinamento (registra o clique) e /t/<token>/reportar registra o
//    reporte. O token e o mesmo; no banco fica so o hash (CampaignEvent.tokenHash);
//  - o rodape identifica a mensagem como simulacao da plataforma Baluarte.

/** Isca de cada template (a mesma ideia que o frontend descreve no cadastro da campanha). */
const ISCAS: Record<string, { assunto: string; corpo: (nome: string, link: string) => string }> = {
  urgencia: {
    assunto: 'Ação necessária: sua conta será bloqueada em 24 horas',
    corpo: (nome, link) =>
      `Olá, ${nome}.\n\n` +
      'Identificamos uma pendência no cadastro da sua conta corporativa. Se ela não for ' +
      'regularizada nas próximas 24 horas, o seu acesso será bloqueado.\n\n' +
      `Regularize agora: ${link}\n\n` +
      'Equipe de Suporte',
  },
  autoridade: {
    assunto: 'Pedido da Diretoria: confirmação ainda hoje',
    corpo: (nome, link) =>
      `${nome},\n\n` +
      'Preciso que você confirme com urgência o documento de aprovação abaixo, antes da reunião ' +
      'do conselho. É um assunto sigiloso: trate diretamente comigo, sem envolver outras áreas.\n\n' +
      `Documento: ${link}\n\n` +
      'Diretoria Executiva',
  },
  curiosidade: {
    assunto: 'Novo plano de cargos e salários (prévia)',
    corpo: (nome, link) =>
      `Oi, ${nome}!\n\n` +
      'A prévia do novo plano de cargos e salários já está disponível para consulta. ' +
      'Dá uma olhada antes da divulgação oficial:\n\n' +
      `${link}\n\n` +
      'Recursos Humanos',
  },
};

export interface DestinatarioCampanha {
  nome: string;
  email: string;
  /** Token do link em claro (so existe aqui e no e-mail). */
  token: string;
}

/** Links do e-mail para um token: treinamento (clique) e reporte. */
export function linksCampanha(token: string): { treinamento: string; reportar: string } {
  const base = `${urlFrontend()}/t/${token}`;
  return { treinamento: base, reportar: `${base}/reportar` };
}

/** Monta o e-mail simulado de um destinatario, pelo template da campanha. */
export function mensagemCampanha(template: string, destinatario: DestinatarioCampanha): Email {
  const isca = ISCAS[template] ?? ISCAS.urgencia;
  const { treinamento, reportar } = linksCampanha(destinatario.token);
  const texto =
    isca.corpo(destinatario.nome, treinamento) +
    '\n\n---\n' +
    'SIMULAÇÃO DE PHISHING — treinamento interno de conscientização da plataforma Baluarte, ' +
    'enviado pela equipe de segurança da sua empresa. Nenhuma senha ou dado pessoal é pedido ' +
    'ou coletado.\n' +
    `Achou este e-mail suspeito? Reporte aqui: ${reportar}`;
  return { para: destinatario.email, assunto: isca.assunto, texto };
}

/**
 * Envia o e-mail da campanha a cada destinatario e marca `enviadoEm` so de quem recebeu.
 * Falha de envio nao desfaz a campanha (o evento continua sem `enviadoEm`). Devolve
 * quantos e-mails sairam.
 */
export async function enviarEmailsCampanha(
  campanha: { id: string; template: string },
  destinatarios: (DestinatarioCampanha & { userId: string })[],
): Promise<number> {
  const enviados: string[] = [];
  // Em sequencia: o volume de uma campanha interna e pequeno e o SMTP de dev (Mailpit)
  // nao precisa de pool; um destinatario que falha nao impede os outros.
  for (const d of destinatarios) {
    if (await enviarEmail(mensagemCampanha(campanha.template, d))) enviados.push(d.userId);
  }
  if (enviados.length > 0) {
    await prisma.campaignEvent.updateMany({
      where: { campaignId: campanha.id, userId: { in: enviados } },
      data: { enviadoEm: new Date() },
    });
  }
  return enviados.length;
}
