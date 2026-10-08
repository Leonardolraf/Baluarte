import bcrypt from 'bcryptjs';
import type { TokenPayload } from '../models/auth.model.js';
import { POLITICA_SENHA } from '../models/dominio.model.js';
import type { UsuarioAtual } from '../models/usuario.model.js';
import * as repo from '../repositories/auth.repository.js';
import { localizarPorEmail } from '../repositories/usuario.repository.js';
import { normalizarEmail } from '../utils/validacao.js';
import { falhar } from '../utils/resposta.js';
import { politicaAuditoria, registrarAuditoria } from './auditoria.service.js';
import { emitirLinkConta, localizarLinkValido } from './linkConta.service.js';
import { gerarToken, SESSAO_MAXIMA_MS } from './token.service.js';

// Regras de autenticacao: login com limite de tentativas, troca e redefinicao de senha,
// sessao (logout e renovacao) e a politica publicada.

// ---- Limite de tentativas de login (politica publicada em /configuracoes/seguranca) ----
// As falhas ficam no banco (tabela LoginFailure), por e-mail digitado: o bloqueio vale
// depois de reiniciar a API e cobre tambem e-mails que nao existem.
const LOGIN_JANELA_MS = 15 * 60 * 1000;
const LOGIN_MAX_FALHAS = 5;
// Hash de sacrificio: mantem o custo do bcrypt igual quando o e-mail nao existe
// (sem isso o tempo de resposta revelaria quais e-mails estao cadastrados).
const HASH_SACRIFICIO = bcrypt.hashSync('baluarte-sem-usuario', 10);

// ---- Limite de pedidos de redefinicao ----
// Pedidos ficam no banco (tabela ResetRequest), como as falhas de login: o limite
// vale entre instancias da API e sobrevive a reinicio.
const RESET_JANELA_MS = 15 * 60 * 1000;
const RESET_MAX_POR_JANELA = 3;
export const MSG_RESET_GENERICA =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha em instantes.';

const desde = (ms: number) => new Date(Date.now() - ms);

/** Zera o limitador de login (usado pelos testes). */
export async function limparLimiteLogin(): Promise<void> {
  await repo.apagarFalhasLogin();
}

/** Zera o limitador de solicitacoes de redefinicao (usado pelos testes). */
export async function limparLimiteReset(): Promise<void> {
  await repo.apagarPedidosReset();
}

/** Registra a falha e devolve quantas a conta acumula na janela. */
async function registrarFalhaLogin(chave: string): Promise<number> {
  await repo.criarFalhaLogin(chave);
  // Poda: o que saiu da janela nao conta mais (endpoint publico: a tabela nao cresce sem limite).
  await repo.apagarFalhasLogin({ antes: desde(LOGIN_JANELA_MS) });
  return repo.contarFalhasLogin(chave, desde(LOGIN_JANELA_MS));
}

/** Login: devolve o token e os dados publicos do usuario, ou lanca o erro do contrato. */
export async function entrar(email: string, senha: string) {
  const chave = normalizarEmail(email);
  if ((await repo.contarFalhasLogin(chave, desde(LOGIN_JANELA_MS))) >= LOGIN_MAX_FALHAS)
    falhar(429, 'Muitas tentativas de login. Aguarde alguns minutos.', 'MUITAS_TENTATIVAS');

  const usuario = await localizarPorEmail(email);
  const ok = await bcrypt.compare(senha, usuario ? usuario.senhaHash : HASH_SACRIFICIO);
  if (!usuario || !ok) {
    const falhas = await registrarFalhaLogin(chave);
    if (usuario && falhas === LOGIN_MAX_FALHAS)
      await registrarAuditoria(usuario.id, 'LOGIN_BLOQUEADO', `${LOGIN_MAX_FALHAS} falhas em 15 min`);
    falhar(401, 'E-mail ou senha inválidos', 'CREDENCIAIS_INVALIDAS');
  }
  if (usuario.status === 'Inativo') falhar(403, 'Usuário inativo. Contate o administrador.', 'USUARIO_INATIVO');
  // Quem ainda nao aceitou o convite entra so pelo link (contas antigas com senha
  // provisoria tambem caem aqui). So chega aqui quem acertou a senha: nada e revelado.
  if (usuario.status === 'Pendente')
    falhar(403, 'Conta ainda não ativada. Crie sua senha pelo link do convite.', 'CONTA_PENDENTE');
  await repo.apagarFalhasLogin({ email: chave });
  await registrarAuditoria(usuario.id, 'LOGIN');

  const token = gerarToken({ idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil });
  return { token, idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil };
}

/** Troca de senha de quem esta logado: encerra as outras sessoes e devolve um token novo. */
export async function trocarSenha(usuario: UsuarioAtual, sessao: TokenPayload, senhaAtual: string, novaSenha: string) {
  if (!(await bcrypt.compare(senhaAtual, usuario.senhaHash)))
    falhar(400, 'A senha atual está incorreta', 'SENHA_ATUAL_INCORRETA');
  if (senhaAtual === novaSenha) falhar(400, 'A nova senha deve ser diferente da atual', 'SENHA_REPETIDA');

  await repo.trocarSenha(usuario.id, await bcrypt.hash(novaSenha, 10));
  await registrarAuditoria(usuario.id, 'ALTERAR_SENHA');
  // A sessao atual continua: devolve um token emitido depois da troca.
  return gerarToken({ idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil, inicioSessao: sessao.inicioSessao });
}

/**
 * "Esqueci a senha". A resposta e sempre a mesma (sem enumerar usuarios); so o limite de
 * pedidos por e-mail gera erro. Conta pendente recebe um convite novo.
 */
export async function solicitarRedefinicao(email: string): Promise<void> {
  const chave = normalizarEmail(email);
  if ((await repo.contarPedidosReset(chave, desde(RESET_JANELA_MS))) >= RESET_MAX_POR_JANELA)
    falhar(429, 'Muitas solicitações. Aguarde alguns minutos.', 'MUITAS_TENTATIVAS');
  await repo.criarPedidoReset(chave);
  // Poda o que ja saiu da janela (endpoint publico: a tabela nao pode crescer sem limite).
  await repo.apagarPedidosReset(desde(RESET_JANELA_MS));

  const usuario = await localizarPorEmail(email);
  if (usuario && usuario.status !== 'Inativo') {
    const tipo = usuario.status === 'Pendente' ? 'CONVITE' : 'RESET';
    await emitirLinkConta(usuario, tipo);
    await registrarAuditoria(usuario.id, tipo === 'CONVITE' ? 'ENVIAR_CONVITE' : 'SOLICITAR_RESET_SENHA');
  }
}

/** Conclui a redefinicao ou o convite pelo link. Devolve a mensagem de sucesso. */
export async function confirmarRedefinicao(token: string, novaSenha: string): Promise<string> {
  const registro = await localizarLinkValido(token);
  if (!registro) falhar(400, 'Token inválido ou expirado', 'TOKEN_RESET_INVALIDO');
  const convite = registro.tipo === 'CONVITE';
  // Mesma regra da troca de senha logada. No convite nunca casa: a conta pendente
  // tem um hash descartavel (linkConta.service.ts), entao a primeira senha sempre passa.
  if (await bcrypt.compare(novaSenha, registro.user.senhaHash))
    falhar(400, 'A nova senha deve ser diferente da atual', 'SENHA_REPETIDA');

  await repo.concluirRedefinicao(registro, await bcrypt.hash(novaSenha, 10));
  await registrarAuditoria(registro.userId, convite ? 'ACEITAR_CONVITE' : 'REDEFINIR_SENHA');
  return convite ? 'Senha cadastrada com sucesso' : 'Senha redefinida com sucesso';
}

/** Dados do link (para a tela conferir antes de pedir a senha), sem consumi-lo. */
export async function verificarLink(token: string) {
  const registro = await localizarLinkValido(token);
  if (!registro) falhar(400, 'Token inválido ou expirado', 'TOKEN_RESET_INVALIDO');
  return { tipo: registro.tipo, nome: registro.user.nome, email: registro.user.email, expiraEm: registro.expiraEm };
}

/** JWT nao se "apaga": sair grava o instante, e exigeToken recusa tokens emitidos antes dele. */
export async function sair(usuario: UsuarioAtual): Promise<void> {
  await repo.encerrarSessoes(usuario.id);
  await registrarAuditoria(usuario.id, 'LOGOUT');
}

/** Token novo para a mesma sessao, com o perfil atual do banco; recusa sessao com mais de 8 h. */
export function renovar(usuario: UsuarioAtual, sessao: TokenPayload): string {
  const inicio = (sessao.inicioSessao ?? sessao.iat ?? 0) * 1000;
  if (Date.now() - inicio > SESSAO_MAXIMA_MS) falhar(401, 'Sessão expirada. Faça login novamente.', 'SESSAO_EXPIRADA');
  return gerarToken({ idUsuario: usuario.id, email: usuario.email, perfil: usuario.perfil, inicioSessao: Math.floor(inicio / 1000) });
}

/** Politica de seguranca publicada (leitura). Publica so o que existe de fato. */
export async function politicaSeguranca() {
  return {
    politicaSenha: { ...POLITICA_SENHA },
    // expiracaoMinutos: sem uso por esse tempo, a sessao expira (o frontend renova
    // enquanto ha uso); nenhuma sessao passa de sessaoMaximaHoras desde o login.
    sessao: { algoritmoToken: 'JWT HS256', expiracaoMinutos: 30, sessaoMaximaHoras: 8, limiteTentativasLogin: LOGIN_MAX_FALHAS, doisFatores: false },
    // B29: retencao de 12 meses; `logImutavel` so com a trava do banco de fato ativa.
    auditoria: await politicaAuditoria(),
  };
}
