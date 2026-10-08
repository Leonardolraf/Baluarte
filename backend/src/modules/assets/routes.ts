import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigePerfil, exigeToken } from '../../http/middlewares.js';
import { OPERADORES, TIPOS_ATIVO } from '../../shared/dominio.js';
import { hostValido, textoPreenchido } from '../../shared/validacao.js';
import * as ativos from './service.js';

export function rotasAtivos(r: Router) {
  // ---- POST /api/assets (contrato N2 AT1; Administrador/Analista) ----
  r.post('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { nome, tipo, host } = req.body ?? {};
    if (!textoPreenchido(nome)) return erro(res, 400, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO');
    if (!TIPOS_ATIVO.includes(tipo)) return erro(res, 400, 'Tipo de ativo inválido', 'TIPO_INVALIDO');
    if (!hostValido(host)) return erro(res, 400, 'Host inválido', 'HOST_INVALIDO');
    const dados = await ativos.cadastrar({ nome, tipo, host: String(host).trim() });
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Ativo cadastrado com sucesso', dados });
  }));

  // ---- GET /assets (Administrador/Analista) ----
  r.get('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await ativos.listar() });
  }));
}
