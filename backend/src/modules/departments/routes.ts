import type { Router } from 'express';
import { z } from 'zod';
import { enviar, wrap } from '../../http/resposta.js';
import { regra, texto, validar } from '../../shared/esquemas.js';
import { exigePerfil, exigeToken, usuarioDe } from '../../http/middlewares.js';
import { OPERADORES } from '../../shared/dominio.js';
import * as departamentos from './service.js';

const CADASTRO = [
  regra('nome', texto, 'Nome do departamento é obrigatório', 'NOME_OBRIGATORIO'),
  regra('nome', z.string().trim().max(60), 'Nome do departamento deve ter até 60 caracteres', 'NOME_INVALIDO'),
];

export function rotasDepartamentos(r: Router) {
  // ---- GET /departamentos (opcoes do cadastro de usuario) ----
  r.get('/departamentos', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await departamentos.listar() });
  }));

  // ---- POST /departamentos (Administrador) ----
  r.post('/departamentos', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const { nome } = validar(req.body, CADASTRO);
    const dados = await departamentos.criar(usuarioDe(req).id, String(nome).trim());
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Departamento cadastrado', dados });
  }));

  // ---- DELETE /departamentos/:id (Administrador) ----
  r.delete('/departamentos/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    await departamentos.excluir(usuarioDe(req).id, req.params.id);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Departamento excluído' });
  }));
}
