import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { email, opcional, regra, texto, umDe, validar } from '../../shared/esquemas.js';
import { exigePerfil, exigeToken, usuarioDe } from '../../http/middlewares.js';
import { OPERADORES, PERFIS, STATUS_USUARIO } from '../../shared/dominio.js';
import { normalizarEmail } from './repository.js';
import * as usuarios from './service.js';
import type { AlteracaoUsuario } from './service.js';

// Regras de entrada (zod), na ordem do contrato.
const NOME = regra('nome', texto, 'Nome é obrigatório', 'NOME_OBRIGATORIO');
const EMAIL = regra('email', email, 'Email inválido', 'EMAIL_INVALIDO');
const PERFIL = regra('perfil', umDe(PERFIS), 'Perfil inválido', 'PERFIL_INVALIDO');
const CADASTRO = [NOME, EMAIL, PERFIL];
const EDICAO = [opcional(NOME), opcional(EMAIL), opcional(PERFIL), opcional(regra('status', umDe(STATUS_USUARIO), 'Status inválido', 'STATUS_INVALIDO'))];

export function rotasUsuarios(r: Router) {
  // ---- POST /api/users (contrato N2 AT1; Administrador/Analista) --------------
  r.post('/users', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { nome, email, perfil, departamento } = validar(req.body, CADASTRO);
    const dados = await usuarios.criar(usuarioDe(req), { nome: nome as string, email: String(email), perfil: perfil as string, departamento });
    return enviar(res, 201, { status: 'sucesso', mensagem: 'Usuário cadastrado com sucesso', dados });
  }));

  // ---- GET /me (usuario logado) ----
  r.get('/me', exigeToken, wrap(async (req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await usuarios.perfilDe(usuarioDe(req)) });
  }));

  // ---- GET /usuarios (Administrador; dado pessoal de toda a empresa) ----
  r.get('/usuarios', exigeToken, exigePerfil('Administrador'), wrap(async (_req, res) => {
    const { usuarios: dados, resumo } = await usuarios.listar();
    enviar(res, 200, { status: 'sucesso', dados, resumo });
  }));

  // ---- PATCH /users/:id (Administrador) ----
  r.patch('/users/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
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
    const atualizado = await usuarios.atualizar(ator, req.params.id, dados, departamento);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Usuário atualizado', dados: atualizado });
  }));

  // ---- DELETE /users/:id (Administrador) ----
  r.delete('/users/:id', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    await usuarios.excluir(usuarioDe(req), req.params.id);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Usuário excluído' });
  }));

  // ---- POST /users/:id/convite (Administrador/Analista) ----
  r.post('/users/:id/convite', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const email = await usuarios.reenviarConvite(usuarioDe(req), req.params.id);
    return enviar(res, 200, { status: 'sucesso', mensagem: `Convite reenviado para ${email}` });
  }));

  // ---- POST /users/:id/redefinir-senha (Administrador) ----
  r.post('/users/:id/redefinir-senha', exigeToken, exigePerfil('Administrador'), wrap(async (req, res) => {
    const email = await usuarios.enviarRedefinicao(usuarioDe(req), req.params.id);
    return enviar(res, 200, { status: 'sucesso', mensagem: `Link de redefinição enviado para ${email}` });
  }));
}
