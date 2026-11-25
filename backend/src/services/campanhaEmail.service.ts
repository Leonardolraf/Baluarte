import { enviarEmail, urlFrontend, type Email } from '../config/email.js';
import type { DestinatarioCampanha } from '../models/campanha.model.js';
import { marcarEnviados } from '../repositories/campanha.repository.js';
import { ISCAS, TEMPLATE_PADRAO_ISCA, type Isca } from './iscas.data.js';

// E-mail da campanha de phishing SIMULADO (treinamento interno). Regras:
//  - sai pelo mesmo canal dos e-mails de conta (config/email.ts): remetente da plataforma
//    (EMAIL_REMETENTE), Mailpit em dev/demo, caixa em memoria nos testes, nada em
//    producao sem SMTP;
//  - so texto: sem anexo, sem HTML (logo, sem pixel de abertura), sem formulario e sem
//    pedido de senha;
//  - os dois links apontam para o proprio frontend da plataforma (nenhum link externo):
//    /t/<token> abre o treinamento (registra o clique) e /t/<token>/reportar registra o
//    reporte. O token e o mesmo; no banco fica so o hash (CampaignEvent.tokenHash);
//  - o rodape identifica a mensagem como simulacao da plataforma Baluarte.

export type { DestinatarioCampanha };

// Sorteio da isca por destinatario. Deterministico: o mesmo destinatario recebe sempre a mesma
// isca do template, mesmo que a campanha reenvie (idempotencia, como o clique). A chave e o token
// do destinatario (um por CampaignEvent, reusado no reenvio; so o hash fica no banco). Hash djb2
// estavel, so para espalhar por igual entre as iscas do array; nao e seguranca.
function indiceEstavel(chave: string, tamanho: number): number {
  let h = 5381;
  for (let i = 0; i < chave.length; i++) h = ((h << 5) + h + chave.charCodeAt(i)) >>> 0;
  return h % tamanho;
}

/** Isca sorteada de um template para um destinatario (determinístico pelo token). */
export function selecionarIsca(template: string, token: string): Isca {
  const iscas = ISCAS[template] ?? ISCAS[TEMPLATE_PADRAO_ISCA];
  return iscas[indiceEstavel(token, iscas.length)];
}

/** Links do e-mail para um token: treinamento (clique) e reporte. */
export function linksCampanha(token: string): { treinamento: string; reportar: string } {
  const base = `${urlFrontend()}/t/${token}`;
  return { treinamento: base, reportar: `${base}/reportar` };
}

/** Monta o e-mail simulado de um destinatario, pelo template da campanha. */
export function mensagemCampanha(template: string, destinatario: DestinatarioCampanha): Email {
  const isca = selecionarIsca(template, destinatario.token);
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
    await marcarEnviados(campanha.id, enviados);
  }
  return enviados.length;
}
