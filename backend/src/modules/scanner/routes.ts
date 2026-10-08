import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigePerfil, exigeToken } from '../../http/middlewares.js';
import { OPERADORES } from '../../shared/dominio.js';
import { vazio } from '../../shared/validacao.js';
import * as varreduras from './service.js';

export function rotasVarreduras(r: Router) {
  // ---- POST /api/scans (contrato N2 AT1; Administrador/Analista) ----
  r.post('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { ativoId } = req.body ?? {};
    if (vazio(ativoId)) return erro(res, 400, 'ativoId é obrigatório', 'ATIVO_OBRIGATORIO');
    const dados = await varreduras.iniciar(String(ativoId));
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Varredura enfileirada com sucesso', dados });
  }));

  // ---- GET /scans (lista tecnica, so quem opera a plataforma: RN-006) ----
  r.get('/scans', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await varreduras.listar() });
  }));
}
