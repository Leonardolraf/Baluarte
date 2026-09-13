import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { erro, enviar } from './util.js';
import { apiRouter } from './routes/api.js';

export const app = express();

// Não anunciar o servidor (o proprio catalogo de achados do scanner trata X-Powered-By como A05).
app.disable('x-powered-by');

// CORS restrito: os frontends chamam a API por proxy (mesma origem); esta lista existe
// para chamadas diretas de navegador em desenvolvimento. `CORS_ORIGIN=*` libera tudo.
const ORIGENS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:8081')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({ origin: ORIGENS.includes('*') ? true : ORIGENS }));
// Corpo JSON pequeno: nenhuma rota recebe payload grande (limita abuso de memoria).
app.use(express.json({ limit: '64kb' }));

// Erro de JSON malformado no corpo (espelha o contrato do stub: 400 JSON_INVALIDO).
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const tipo = err && typeof err === 'object' ? (err as { type?: string }).type : undefined;
  if (tipo === 'entity.parse.failed') {
    return erro(res, 400, 'JSON inválido no corpo da requisição', 'JSON_INVALIDO');
  }
  // Corpo acima do limite (express.json 64kb): 413 padronizado, sem HTML/stack do Express.
  if (tipo === 'entity.too.large') {
    return erro(res, 413, 'Corpo da requisição excede o limite permitido', 'CORPO_MUITO_GRANDE');
  }
  next(err);
});

app.get('/health', (_req, res) => enviar(res, 200, { status: 'ok' }));

app.use('/api', apiRouter);

// Rota nao encontrada (espelha o stub).
app.use((_req, res) => erro(res, 404, 'Rota não encontrada', 'ROTA_NAO_ENCONTRADA'));
