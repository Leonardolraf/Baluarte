import type { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

export function rotasDashboard(r: Router) {
  r.get('/dashboard', exigeToken, wrap(dashboardController.painel));
}
