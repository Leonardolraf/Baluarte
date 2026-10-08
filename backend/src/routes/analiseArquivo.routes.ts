import type { Router } from 'express';
import * as analiseArquivoController from '../controllers/analiseArquivo.controller.js';
import { exigeToken } from '../middlewares/auth.middleware.js';
import { wrap } from '../utils/resposta.js';

// Rotas da analise de arquivos (B04): abertas aos tres perfis, sempre com login. O anexo
// suspeito de campanha (B23) usa a mesma rota de envio, com login: nao ha envio pelo link publico.
export function rotasAnaliseArquivo(r: Router) {
  r.post('/arquivos/analise', exigeToken, wrap(analiseArquivoController.analisar));
  r.get('/arquivos/analises', exigeToken, wrap(analiseArquivoController.listar));
  r.get('/arquivos/campanhas-recebidas', exigeToken, wrap(analiseArquivoController.campanhasRecebidas));
}
