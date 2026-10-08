import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { PREF_CAMPOS, PREFERENCIAS, type PrefCampo } from '../models/notificacao.model.js';
import * as notificacaoService from '../services/notificacao.service.js';
import { enviar, erro } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller das preferencias de notificacao do usuario logado.

/** GET /configuracoes/notificacoes (protegido). */
export async function ler(req: Request, res: Response) {
  return enviar(res, 200, { status: 'sucesso', dados: await notificacaoService.ler(usuarioDe(req).id) });
}

/** PUT /configuracoes/notificacoes (protegido; so booleanos). */
export async function salvar(req: Request, res: Response) {
  const corpo = validar(req.body, PREFERENCIAS);
  const dados: Partial<Record<PrefCampo, boolean>> = {};
  for (const campo of PREF_CAMPOS) if (corpo[campo] !== undefined) dados[campo] = corpo[campo] as boolean;
  if (Object.keys(dados).length === 0)
    return erro(res, 400, 'Nenhuma preferência informada', 'PREFERENCIA_INVALIDA');
  const salvas = await notificacaoService.salvar(usuarioDe(req).id, dados);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Preferências salvas', dados: salvas });
}
