import 'dotenv/config';
import { app } from './app.js';

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, () => {
  console.log(`[Baluarte v2] API real ouvindo em http://localhost:${PORT}`);
});
