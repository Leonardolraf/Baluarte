import { Router } from 'express';
import { rotasAuth } from '../modules/auth/routes.js';
import { rotasUsuarios } from '../modules/users/routes.js';
import { rotasDepartamentos } from '../modules/departments/routes.js';
import { rotasAtivos } from '../modules/assets/routes.js';
import { rotasVarreduras } from '../modules/scanner/routes.js';
import { rotasVulnerabilidades } from '../modules/reports/routes.js';
import { rotasCampanhas } from '../modules/campaigns/routes.js';
import { rotasTreinamento } from '../modules/training/routes.js';
import { rotasDashboard } from '../modules/dashboard/routes.js';
import { rotasNotificacoes } from '../modules/notifications/routes.js';

// Roteador da API (/api): cada modulo de dominio registra as proprias rotas. As 6 rotas do
// contrato N2 AT1 ficam nos modulos auth (login), users, assets, scanner, campaigns e
// reports (classificacao CVSS), com as mesmas mensagens e codigos de erro.
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
