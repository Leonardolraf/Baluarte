import type { Router } from 'express';
import { enviar, wrap } from '../../http/resposta.js';
import { notaCvss, regra, textoDeQuery, umDe, validar } from '../../shared/esquemas.js';
import { exigePerfil, exigeToken } from '../../http/middlewares.js';
import { OPERADORES, STATUS_FINDING } from '../../shared/dominio.js';
import * as vulnerabilidades from './service.js';

export function rotasVulnerabilidades(r: Router) {
  // ---- GET /api/findings/classificacao?cvss=X (contrato N2 AT1; publico) ----
  r.get('/findings/classificacao', wrap(async (req, res) => {
    validar(req.query, [regra('cvss', notaCvss, 'CVSS deve estar entre 0.0 e 10.0', 'CVSS_INVALIDO')]);
    return enviar(res, 200, { status: 'sucesso', dados: vulnerabilidades.classificar(Number(req.query.cvss)) });
  }));

  // ---- GET /vulnerabilidades?severidade=&status=&q= (Administrador/Analista) ----
  r.get('/vulnerabilidades', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    // Coage a string: `?severidade[]=x` / `?q[$ne]=x` viram objeto/array no parser do Express.
    const { lista, resumo } = await vulnerabilidades.listar({
      severidade: textoDeQuery.parse(req.query.severidade),
      status: textoDeQuery.parse(req.query.status),
      q: textoDeQuery.parse(req.query.q),
    });
    enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
  }));

  // ---- GET /vulnerabilidades/:id ----
  r.get('/vulnerabilidades/:id', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await vulnerabilidades.detalhe(req.params.id) });
  }));

  // ---- PATCH /vulnerabilidades/:id (status, "Risco aceito" incluso) ----
  r.patch('/vulnerabilidades/:id', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { status } = validar(req.body, [regra('status', umDe(STATUS_FINDING), 'Status inválido', 'STATUS_INVALIDO')]);
    const dados = await vulnerabilidades.alterarStatus(req.params.id, String(status));
    enviar(res, 200, { status: 'sucesso', mensagem: 'Status atualizado', dados });
  }));
}
