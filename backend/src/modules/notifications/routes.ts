import type { Router } from 'express';
import { z } from 'zod';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { opcional, regra, validar } from '../../shared/esquemas.js';
import { exigeToken, usuarioDe } from '../../http/middlewares.js';
import * as preferencias from './service.js';
import { PREF_CAMPOS, type PrefCampo } from './service.js';

// Cada preferencia, se enviada, tem de ser booleana.
const PREFERENCIAS = PREF_CAMPOS.map((campo) =>
  opcional(regra(campo, z.boolean(), `O campo ${campo} deve ser verdadeiro ou falso`, 'PREFERENCIA_INVALIDA')),
);

export function rotasNotificacoes(r: Router) {
  // ---- GET /configuracoes/notificacoes (protegido) ----
  r.get('/configuracoes/notificacoes', exigeToken, wrap(async (req, res) => {
    return enviar(res, 200, { status: 'sucesso', dados: await preferencias.ler(usuarioDe(req).id) });
  }));

  // ---- PUT /configuracoes/notificacoes (protegido; so booleanos) ----
  r.put('/configuracoes/notificacoes', exigeToken, wrap(async (req, res) => {
    const corpo = validar(req.body, PREFERENCIAS);
    const dados: Partial<Record<PrefCampo, boolean>> = {};
    for (const campo of PREF_CAMPOS) if (corpo[campo] !== undefined) dados[campo] = corpo[campo] as boolean;
    if (Object.keys(dados).length === 0)
      return erro(res, 400, 'Nenhuma preferência informada', 'PREFERENCIA_INVALIDA');
    const salvas = await preferencias.salvar(usuarioDe(req).id, dados);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Preferências salvas', dados: salvas });
  }));
}
