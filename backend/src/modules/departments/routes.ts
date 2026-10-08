import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigePerfil, exigeToken, usuarioDe } from '../../http/middlewares.js';
import { OPERADORES } from '../../shared/dominio.js';
import { vazio } from '../../shared/validacao.js';
import * as departamentos from './service.js';

export function rotasDepartamentos(r: Router) {
  // ---- GET /departamentos (opcoes do cadastro de usuario) ----
  r.get('/departamentos', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await departamentos.listar() });
  }));

  // ---- POST /departamentos (Administrador) ----
  r.post('/departamentos', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const { nome } = req.body ?? {};
    if (typeof nome !== 'string' || vazio(nome.trim()))
      return erro(res, 400, 'Nome do departamento é obrigatório', 'NOME_OBRIGATORIO');
    const limpo = nome.trim();
    if (limpo.length > 60) return erro(res, 400, 'Nome do departamento deve ter até 60 caracteres', 'NOME_INVALIDO');
    const dados = await departamentos.criar(usuarioDe(req).id, limpo);
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Departamento cadastrado', dados });
  }));

  // ---- DELETE /departamentos/:id (Administrador) ----
  r.delete('/departamentos/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    await departamentos.excluir(usuarioDe(req).id, req.params.id);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Departamento excluído' });
  }));
}
