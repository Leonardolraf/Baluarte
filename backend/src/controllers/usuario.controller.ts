import type { Request, Response } from 'express';
import { usuarioDe } from '../middlewares/auth.middleware.js';
import { CADASTRO, EDICAO, type AlteracaoUsuario } from '../models/usuario.model.js';
import { normalizarEmail } from '../repositories/usuario.repository.js';
import * as usuarioService from '../services/usuario.service.js';
import { enviar, erro } from '../utils/resposta.js';
import { validar } from '../utils/esquemas.js';

// Controller de usuarios: cadastro (contrato N2 AT1), perfil do logado, lista, edicao,
// exclusao, reenvio de convite e envio do link de redefinicao.

/** POST /users (contrato N2 AT1; Administrador/Analista). */
export async function cadastrar(req: Request, res: Response) {
  const { nome, email, perfil, departamento } = validar(req.body, CADASTRO);
  const dados = await usuarioService.criar(usuarioDe(req), { nome: nome as string, email: String(email), perfil: perfil as string, departamento });
  return enviar(res, 201, { status: 'sucesso', mensagem: 'Usuário cadastrado com sucesso', dados });
}

/** GET /me (usuario logado). */
export async function perfil(req: Request, res: Response) {
  enviar(res, 200, { status: 'sucesso', dados: await usuarioService.perfilDe(usuarioDe(req)) });
}

/** GET /usuarios (Administrador; dado pessoal de toda a empresa). */
export async function listar(_req: Request, res: Response) {
  const { usuarios: dados, resumo } = await usuarioService.listar();
  enviar(res, 200, { status: 'sucesso', dados, resumo });
}

/** PATCH /users/:id (Administrador). */
export async function atualizar(req: Request, res: Response) {
  const ator = usuarioDe(req);
  // Formato dos campos enviados (os ausentes nao mudam).
  const { nome, email, perfil, status, departamento } = validar(req.body, EDICAO);
  const dados: AlteracaoUsuario = {};
  if (nome !== undefined) dados.nome = String(nome).trim();
  if (email !== undefined) dados.email = normalizarEmail(email);
  if (perfil !== undefined) dados.perfil = String(perfil);
  if (status !== undefined) {
    if (req.params.id === ator.id && status === 'Inativo')
      return erro(res, 422, 'Você não pode inativar a própria conta', 'AUTO_INATIVACAO');
    dados.status = String(status);
  }
  const atualizado = await usuarioService.atualizar(ator, req.params.id, dados, departamento);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Usuário atualizado', dados: atualizado });
}

/** DELETE /users/:id (Administrador). */
export async function excluir(req: Request, res: Response) {
  await usuarioService.excluir(usuarioDe(req), req.params.id);
  return enviar(res, 200, { status: 'sucesso', mensagem: 'Usuário excluído' });
}

/** POST /users/:id/convite (Administrador/Analista). */
export async function reenviarConvite(req: Request, res: Response) {
  const email = await usuarioService.reenviarConvite(usuarioDe(req), req.params.id);
  return enviar(res, 200, { status: 'sucesso', mensagem: `Convite reenviado para ${email}` });
}

/** POST /users/:id/redefinir-senha (Administrador). */
export async function enviarRedefinicao(req: Request, res: Response) {
  const email = await usuarioService.enviarRedefinicao(usuarioDe(req), req.params.id);
  return enviar(res, 200, { status: 'sucesso', mensagem: `Link de redefinição enviado para ${email}` });
}
