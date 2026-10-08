// Aplica a politica de retencao da trilha de auditoria (B29, RNF-002) fora de uma requisicao,
// para rodar agendado (cron do Railway, cron do sistema, CI agendado):
//   npm run auditoria:retencao
// Usa o mesmo service de POST /api/auditoria/retencao: apaga so registros com mais de 12 meses
// e grava APLICAR_RETENCAO_AUDITORIA sem autor (usuarioId null). Le DATABASE_URL do ambiente.
import 'dotenv/config';
import { prisma } from '../src/config/db.js';
import { aplicarRetencao } from '../src/services/auditoria.service.js';

try {
  const r = await aplicarRetencao(null);
  console.log(`[retencao] ${r.apagados} registro(s) anteriores a ${r.corte.toISOString()} apagados (${r.retencaoMeses} meses)`);
} catch (e) {
  console.error('[retencao] falhou', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
