import 'dotenv/config';
import { app } from './app.js';
import { validarSegredoJwt } from './auth.js';

// Em producao, sem JWT_SECRET adequado o processo nem sobe.
validarSegredoJwt();

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, () => {
  console.log(`[Baluarte v2] API real ouvindo em http://localhost:${PORT}`);
});
