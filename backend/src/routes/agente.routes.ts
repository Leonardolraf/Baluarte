import type { Router } from 'express';
import * as agenteController from '../controllers/agente.controller.js';
import { wrap } from '../utils/resposta.js';

// Rotas do agente de estacao (osquery, plugin "tls"). Sem JWT: a inscricao e protegida
// pelo segredo OSQUERY_ENROLL_SECRET e as demais pela chave da estacao (node_key) no corpo.
// No osquery: --enroll_tls_endpoint, --config_tls_endpoint e --logger_tls_endpoint.
export function rotasAgente(r: Router) {
  r.post('/agentes/osquery/enroll', wrap(agenteController.inscrever));
  r.post('/agentes/osquery/config', wrap(agenteController.configuracao));
  r.post('/agentes/osquery/logger', wrap(agenteController.receberLog));
}
