import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import * as treinamentoService from '../services/treinamento.service.js';
import { enviar } from '../utils/resposta.js';

// Controller do treinamento pos-clique. Dentro do sistema (com login), `:token` e o id do
// evento de campanha; pelo link do e-mail simulado (publico), e o token aleatorio do link.

/** GET /treinamentos/consolidado (Administrador/Analista). */
export async function consolidado(_req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await treinamentoService.consolidado() });
}

/** GET /treinamentos/:token (com login). */
export async function ver(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await treinamentoService.ver(usuarioDe(req), req.params.token) });
}

/** POST /treinamentos/:token/concluir (com login). */
export async function concluir(req: Request, res: Response) {
  const dados = await treinamentoService.concluir(usuarioDe(req), req.params.token);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Treinamento concluído', dados });
}

/** GET /treinamentos/link/:token (publico). */
export async function abrirPeloLink(req: Request, res: Response) {
  return enviar(res, 200, { status: 'sucesso', dados: await treinamentoService.abrirPeloLink(req.params.token) });
}

/** POST /treinamentos/link/:token/concluir (publico). */
export async function concluirPeloLink(req: Request, res: Response) {
  const dados = await treinamentoService.concluirPeloLink(req.params.token);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Treinamento concluído', dados });
}

/**
 * POST /treinamentos/link/:token/reportar (publico). O frontend pede confirmacao antes de
 * chamar (um GET nao registra nada: leitores de e-mail e antivirus que pre-visitam links
 * nao "reportam" por engano).
 */
export async function reportar(req: Request, res: Response) {
  const dados = await treinamentoService.reportar(req.params.token);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'E-mail reportado. Obrigado por avisar a equipe de segurança.', dados });
}
