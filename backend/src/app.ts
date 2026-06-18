import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { erro, enviar } from './util.js';
import { apiRouter } from './routes/api.js';

export const app = express();

app.use(cors());
app.use(express.json());

// Erro de JSON malformado no corpo (espelha o contrato do stub: 400 JSON_INVALIDO).
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    return erro(res, 400, 'JSON inválido no corpo da requisição', 'JSON_INVALIDO');
  }
  next(err);
});

app.get('/health', (_req, res) => enviar(res, 200, { status: 'ok' }));

app.use('/api', apiRouter);

// Rota nao encontrada (espelha o stub).
app.use((_req, res) => erro(res, 404, 'Rota não encontrada', 'ROTA_NAO_ENCONTRADA'));
