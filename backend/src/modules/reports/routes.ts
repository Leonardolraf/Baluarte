import type { Router } from 'express';
import { enviar, erro, wrap } from '../../http/resposta.js';
import { exigePerfil, exigeToken } from '../../http/middlewares.js';
import { OPERADORES, STATUS_FINDING } from '../../shared/dominio.js';
import { queryString } from '../../shared/validacao.js';
import * as vulnerabilidades from './service.js';

export function rotasVulnerabilidades(r: Router) {
  // ---- GET /api/findings/classificacao?cvss=X (contrato N2 AT1; publico) ----
  r.get('/findings/classificacao', wrap(async (req, res) => {
    const raw = req.query.cvss;
    const cvss = Number(raw);
    if (raw === undefined || raw === '' || Number.isNaN(cvss) || cvss < 0 || cvss > 10)
      return erro(res, 400, 'CVSS deve estar entre 0.0 e 10.0', 'CVSS_INVALIDO');
    return enviar(res, 200, { status: 'sucesso', dados: vulnerabilidades.classificar(cvss) });
  }));

  // ---- GET /vulnerabilidades?severidade=&status=&q= (Administrador/Analista) ----
  r.get('/vulnerabilidades', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    // Coage a string: `?severidade[]=x` / `?q[$ne]=x` viram objeto/array no parser do Express.
    const { lista, resumo } = await vulnerabilidades.listar({
      severidade: queryString(req.query.severidade),
      status: queryString(req.query.status),
      q: queryString(req.query.q),
    });
    enviar(res, 200, { status: 'sucesso', dados: lista, resumo });
  }));

  // ---- GET /vulnerabilidades/:id ----
  r.get('/vulnerabilidades/:id', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    enviar(res, 200, { status: 'sucesso', dados: await vulnerabilidades.detalhe(req.params.id) });
  }));

  // ---- PATCH /vulnerabilidades/:id (status, "Risco aceito" incluso) ----
  r.patch('/vulnerabilidades/:id', exigeToken, exigePerfil(...OPERADORES), wrap(async (req, res) => {
    const { status } = req.body ?? {};
    if (!STATUS_FINDING.includes(status)) return erro(res, 400, 'Status inválido', 'STATUS_INVALIDO');
    const dados = await vulnerabilidades.alterarStatus(req.params.id, status);
    enviar(res, 200, { status: 'sucesso', mensagem: 'Status atualizado', dados });
  }));
}
