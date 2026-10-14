import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { CADASTRO_CONFIRMACAO, CADASTRO_NOME, CADASTRO_TEMPLATE, filtroDestinatarios } from '../models/campanha.model.js';
import { destinatarioInterno } from '../models/dominio.model.js';
import * as campanhaService from '../services/campanha.service.js';
import { enviar, erro } from '../utils/resposta.js';
import { email as emailValido, validar } from '../utils/esquemas.js';

// Controller de campanhas de phishing simulado.

/**
 * POST /campaigns (contrato N2 AT1; Administrador/Analista). Contrato original: um
 * `destinatario`. Extensao compativel: `destinatarios[]` (o frontend novo envia os dois;
 * o Postman/Robot continuam enviando so o primeiro). Ordem: nome -> destinatarios
 * (formato e dominio interno) -> template -> confirmarEnvioTotal (aditivo e opcional; a trava
 * de envio em massa fica no service, depois da elegibilidade de cada destinatario).
 */
export async function cadastrar(req: Request, res: Response) {
  const { nome, destinatario, destinatarios, template } = validar(req.body, CADASTRO_NOME);

  const brutos: unknown[] = Array.isArray(destinatarios) && destinatarios.length > 0 ? destinatarios : [destinatario];
  const emails: string[] = [];
  for (const item of brutos) {
    if (!emailValido.safeParse(item).success) return erro(res, 400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO');
    const email = String(item).trim();
    if (!destinatarioInterno(email))
      return erro(res, 422, 'Destinatário não autorizado: apenas e-mails internos', 'DESTINATARIO_EXTERNO');
    if (!emails.some((e) => e.toLowerCase() === email.toLowerCase())) emails.push(email);
  }
  validar(req.body, CADASTRO_TEMPLATE);
  const { confirmarEnvioTotal } = validar(req.body, CADASTRO_CONFIRMACAO);

  const dados = await campanhaService.criar(usuarioDe(req).id, {
    nome: nome as string,
    template: template as string,
    emails,
    confirmado: confirmarEnvioTotal === true,
  });
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Campanha criada com sucesso', dados });
}

/** GET /campanhas (lista com metricas). */
export async function listar(_req: Request, res: Response) {
  const { lista, resumo } = await campanhaService.listar();
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/**
 * GET /campanhas/destinatarios?departamento=<id>[&departamento=<id>...] ou ?todos=1
 * (Administrador/Analista): destinatarios elegiveis para o formulario de campanha.
 */
export async function destinatarios(req: Request, res: Response) {
  const { lista, resumo } = await campanhaService.destinatariosElegiveis(filtroDestinatarios(req.query));
  enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
}

/** GET /campanhas/:id (relatorio). */
export async function relatorio(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await campanhaService.relatorio(req.params.id) });
}

/** DELETE /campanhas/:id (Administrador/Analista). */
export async function excluir(req: Request, res: Response) {
  await campanhaService.excluir(usuarioDe(req).id, req.params.id);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Campanha excluída' });
}
