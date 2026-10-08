import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { CADASTRO } from '../models/departamento.model.js';
import * as departamentoService from '../services/departamento.service.js';
import { enviar } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller de departamentos.

/** GET /departamentos (opcoes do cadastro de usuario). */
export async function listar(_req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await departamentoService.listar() });
}

/** POST /departamentos (Administrador). */
export async function cadastrar(req: Request, res: Response) {
  const { nome } = validar(req.body, CADASTRO);
  const dados = await departamentoService.criar(usuarioDe(req).id, String(nome).trim());
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Departamento cadastrado', dados });
}

/** DELETE /departamentos/:id (Administrador). */
export async function excluir(req: Request, res: Response) {
  await departamentoService.excluir(usuarioDe(req).id, req.params.id);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Departamento excluído' });
}
