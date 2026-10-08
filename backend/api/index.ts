import { app } from '../src/app.js';
import { validarSegredoJwt } from '../src/services/token.service.js';

// Fail-fast igual ao servidor de longa duracao: sem JWT_SECRET forte em producao,
// a funcao nao atende requisicao nenhuma (melhor 500 ruidoso que token fraco valido).
validarSegredoJwt();

// O runtime Node da Vercel aceita o app Express como handler (req, res).
export default app;
