import 'dotenv/config';
import { app } from './app.js';
import { escutar } from './config/servidorHttp.js';
import { validarSegredoJwt } from './services/token.service.js';

// Em producao, sem JWT_SECRET adequado o processo nem sobe.
validarSegredoJwt();

const PORT = Number(process.env.PORT) || 8080;

// Com as opcoes de config/servidorHttp.ts (prazo do corpo aplicado por rota, nao globalmente).
await escutar(app, PORT);
console.log(`[Baluarte v2] API real ouvindo em http://localhost:${PORT}`);
