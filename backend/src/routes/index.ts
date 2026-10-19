import { Router } from 'express';
import { rotasAnaliseArquivo } from './analiseArquivo.routes.js';
import { rotasAgente } from './agente.routes.js';
import { rotasAtivos } from './ativo.routes.js';
import { rotasAvisoMonitoramento } from './avisoMonitoramento.routes.js';
import { rotasAuditoria } from './auditoria.routes.js';
import { rotasAuth } from './auth.routes.js';
import { rotasCampanhas } from './campanha.routes.js';
import { rotasDashboard } from './dashboard.routes.js';
import { rotasDepartamentos } from './departamento.routes.js';
import { rotasEstacoes } from './estacao.routes.js';
import { rotasNotificacoes } from './notificacao.routes.js';
import { rotasTreinamento } from './treinamento.routes.js';
import { rotasUsuarios } from './usuario.routes.js';
import { rotasVarreduras } from './varredura.routes.js';
import { rotasVulnerabilidades } from './vulnerabilidade.routes.js';

// Roteador da API (/api). Cada arquivo de rotas declara caminho + middlewares + controller
// de uma funcionalidade; a ordem de registro abaixo e a ordem em que o Express casa as
// rotas. As 6 rotas do contrato N2 AT1 ficam em auth (login), usuario, ativo, varredura,
// campanha e vulnerabilidade (classificacao CVSS), com as mesmas mensagens e codigos de erro.
export const apiRouter = Router();

rotasAuth(apiRouter);
rotasUsuarios(apiRouter);
rotasDepartamentos(apiRouter);
rotasAtivos(apiRouter);
rotasVarreduras(apiRouter);
rotasVulnerabilidades(apiRouter);
rotasCampanhas(apiRouter);
rotasTreinamento(apiRouter);
rotasDashboard(apiRouter);
rotasNotificacoes(apiRouter);
rotasAnaliseArquivo(apiRouter);
rotasAgente(apiRouter);
rotasAuditoria(apiRouter);
rotasEstacoes(apiRouter);
rotasAvisoMonitoramento(apiRouter);
