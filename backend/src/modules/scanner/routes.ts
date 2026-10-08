import type { Router } from 'express';
import { enviar, wrap } from '../../http/resposta.js';
import { preenchido, regra, validar } from '../../shared/esquemas.js';
import { exigePerfil, exigeToken } from '../../http/middlewares.js';
import { OPERADORES } from '../../shared/dominio.js';
import * as varreduras from './service.js';

export function rotasVarreduras(r: Router) {
  // ---- POST /api/scans (contrato N2 AT1; Administrador/Analista) ----
  r.post('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { ativoId } = validar(req.body, [regra('ativoId', preenchido, 'ativoId é obrigatório', 'ATIVO_OBRIGATORIO')]);
    const dados = await varreduras.iniciar(String(ativoId));
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Varredura enfileirada com sucesso', dados });
  }));

  // ---- GET /scans (lista tecnica, so quem opera a plataforma: RN-006) ----
  r.get('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await varreduras.listar() });
  }));
}
