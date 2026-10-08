// Fica em src/app.ts (e nao numa das pastas de camada) porque o preset Express da Vercel
// procura o app neste caminho e exige que o arquivo importe o express.
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { erro, enviar } from './utils/resposta.js';
import { apiRouter } from './routes/index.js';

export const app = express();

// Não anunciar o servidor (o proprio catalogo de achados do scanner trata X-Powered-By como A05).
app.disable('x-powered-by');

// Cabecalhos de seguranca (helmet). Registrado antes de tudo para valer tambem nas respostas
// de erro (400 JSON_INVALIDO, 404 ROTA_NAO_ENCONTRADA, preflight do CORS). A API so devolve
// JSON, nunca HTML: a CSP nega qualquer recurso e qualquer moldura (frame-ancestors 'none').
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS: 1 ano com subdominios (padrao do helmet); navegadores so o respeitam em HTTPS.
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  }),
);

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

// Caractere NUL (\u0000) nao tem uso legitimo em nenhum campo e o PostgreSQL recusa texto
// com ele (a consulta estouraria como 500). Barrado na borda: corpo, query e caminho.
function temNul(valor: unknown, profundidade = 0): boolean {
  if (typeof valor === 'string') return valor.includes('\u0000');
  if (profundidade > 20 || valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(([k, v]) => k.includes('\u0000') || temNul(v, profundidade + 1));
}
app.use((req: Request, res: Response, next: NextFunction) => {
  if (/%00/i.test(req.originalUrl) || temNul(req.body) || temNul(req.query))
    return erro(res, 400, 'Caractere inválido na requisição', 'CARACTERE_INVALIDO');
  next();
});

app.get('/health', (_req, res) => enviar(res, 200, { status: 'ok' }));

app.use('/api', apiRouter);

// Rota nao encontrada (espelha o stub).
app.use((_req, res) => erro(res, 404, 'Rota não encontrada', 'ROTA_NAO_ENCONTRADA'));
