import type { Router } from 'express';
import { enviar, wrap } from '../../http/resposta.js';
import { host, regra, texto, umDe, validar } from '../../shared/esquemas.js';
import { exigePerfil, exigeToken } from '../../http/middlewares.js';
import { OPERADORES, TIPOS_ATIVO } from '../../shared/dominio.js';
import * as ativos from './service.js';

const CADASTRO = [
  regra('nome', texto, 'Nome do ativo é obrigatório', 'NOME_OBRIGATORIO'),
  regra('tipo', umDe(TIPOS_ATIVO), 'Tipo de ativo inválido', 'TIPO_INVALIDO'),
  regra('host', host, 'Host inválido', 'HOST_INVALIDO'),
];

export function rotasAtivos(r: Router) {
  // ---- POST /api/assets (contrato N2 AT1; Administrador/Analista) ----
  r.post('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { nome, tipo, host } = validar(req.body, CADASTRO);
    const dados = await ativos.cadastrar({ nome: nome as string, tipo: tipo as string, host: String(host).trim() });
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Ativo cadastrado com sucesso', dados });
  }));

  // ---- GET /assets (Administrador/Analista) ----
  r.get('/assets', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await ativos.listar() });
  }));
}
