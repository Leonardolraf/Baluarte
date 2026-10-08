import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigeToken, usuarioDe } from '../../http/middlewares.js';
import * as preferencias from './service.js';
import { PREF_CAMPOS, type PrefCampo } from './service.js';

export function rotasNotificacoes(r: Router) {
  // ---- GET /configuracoes/notificacoes (protegido) ----
  r.get('/configuracoes/notificacoes', exigeToken, wrap(async (req, res) => {
    return enviar(res, 200, { status: 'sucesso', dados: await preferencias.ler(usuarioDe(req).id) });
  }));

  // ---- PUT /configuracoes/notificacoes (protegido; so booleanos) ----
  r.put('/configuracoes/notificacoes', exigeToken, wrap(async (req, res) => {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const dados: Partial<Record<PrefCampo, boolean>> = {};
    for (const campo of PREF_CAMPOS) {
      const valor = corpo[campo];
      if (valor === undefined) continue;
      if (typeof valor !== 'boolean')
        return erro(res, 400, `O campo ${campo} deve ser verdadeiro ou falso`, 'PREFERENCIA_INVALIDA');
      dados[campo] = valor;
    }
    if (Object.keys(dados).length === 0)
      return erro(res, 400, 'Nenhuma preferência informada', 'PREFERENCIA_INVALIDA');
    const salvas = await preferencias.salvar(usuarioDe(req).id, dados);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Preferências salvas', dados: salvas });
  }));
}
