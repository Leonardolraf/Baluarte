// Ponto de entrada que o preset Express da Vercel procura em caminhos fixos (src/app.ts,
// src/server.ts, ...). O app de verdade fica em src/http/app.ts; este arquivo so o reexporta.
// Nao mover sem ajustar a configuracao do projeto baluarte-api na Vercel.
export { app, app as default } from './http/app.js';
