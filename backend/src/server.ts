import 'dotenv/config';
import { app } from './app.js';
import { validarSegredoJwt } from './services/token.service.js';
import { validarDominioInterno } from './models/dominio.model.js';

// Em producao, sem JWT_SECRET adequado ou sem DOMINIO_INTERNO valido (DT28) o processo nem sobe.
validarSegredoJwt();
validarDominioInterno();

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, () => {
  console.log(`[Baluarte v2] API real ouvindo em http://localhost:${PORT}`);
});
