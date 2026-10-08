import type { Router } from 'express';
import { enviar, wrap } from '../../http/resposta.js';
import { exigePerfil, exigeToken, usuarioDe } from '../../http/middlewares.js';
import { OPERADORES } from '../../shared/dominio.js';
import * as treinamento from './service.js';

export function rotasTreinamento(r: Router) {
  // ---- GET /treinamentos/consolidado (Administrador/Analista) ----
  // Registrada ANTES de /treinamentos/:token, senao "consolidado" seria lido como token.
  r.get('/treinamentos/consolidado', exigeToken, exigePerfil(...OPERADORES), wrap(async (_req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await treinamento.consolidado() });
  }));

  // ---- Dentro do sistema (com login): `:token` e o id do evento de campanha ----
  r.get('/treinamentos/:token', exigeToken, wrap(async (req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await treinamento.ver(usuarioDe(req), req.params.token) });
  }));

  r.post('/treinamentos/:token/concluir', exigeToken, wrap(async (req, res) => {
    const dados = await treinamento.concluir(usuarioDe(req), req.params.token);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Treinamento concluído', dados });
  }));

  // ---- Link do e-mail simulado (publico, sem login) ----
  r.get('/treinamentos/link/:token', wrap(async (req, res) => {
    return enviar(res, 200, { status: 'sucesso', dados: await treinamento.abrirPeloLink(req.params.token) });
  }));

  r.post('/treinamentos/link/:token/concluir', wrap(async (req, res) => {
    const dados = await treinamento.concluirPeloLink(req.params.token);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'Treinamento concluído', dados });
  }));

  // O frontend pede confirmacao antes de chamar (um GET nao registra nada: leitores de
  // e-mail e antivirus que pre-visitam links nao "reportam" por engano).
  r.post('/treinamentos/link/:token/reportar', wrap(async (req, res) => {
    const dados = await treinamento.reportar(req.params.token);
    return enviar(res, 200, { status: 'sucesso', mensagem: 'E-mail reportado. Obrigado por avisar a equipe de segurança.', dados });
  }));
}
