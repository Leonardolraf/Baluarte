// Testes de UNIDADE dos limites de memoria do docker-compose.servidor.yml (DT36, VM).
// Os numeros foram medidos (comentario do topo do arquivo); este teste so impede que alguem mude
// um deles e quebre a relacao entre eles sem perceber:
//   - backend, db e clamav tem mem_limit;
//   - a soma cabe nos ~6 GiB livres da VM;
//   - o clamav fica acima do pico medido do clamd (2,7 GiB num zip com membro de 900 MiB);
//   - o heap do Node (NODE_OPTIONS --max-old-space-size) fica abaixo do mem_limit da API, com
//     folga para o que nao e heap, para o Node parar por heap antes do OOM-killer do conteiner,
//     e acima do pico de heap medido com o teto de achados do relatorio (~0,9 GB com 50 mil).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TETO_ACHADOS_RELATORIO } from '../../src/models/vulnerabilidade.model.js';

const SERVIDOR = fileURLToPath(new URL('../../../docker-compose.servidor.yml', import.meta.url));
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Bloco de cada servico de primeiro nivel (indentacao de 2 espacos sob `services:`). */
function blocos(texto: string): Record<string, string> {
  const servicos = texto.slice(texto.indexOf('\nservices:'));
  const r: Record<string, string> = {};
  for (const m of servicos.matchAll(/^ {2}(\w+):\n((?: {4}.*\n|\s*\n|\s*#.*\n)*)/gm)) r[m[1]] = m[2];
  return r;
}

/** mem_limit no formato do compose ("2304m", "3g", bytes) em bytes. */
function bytes(valor: string): number {
  const m = /^(\d+)([kmg]?)b?$/i.exec(valor.trim());
  assert.ok(m, `mem_limit inválido: ${valor}`);
  return Number(m[1]) * { '': 1, k: 1024, m: MIB, g: GIB }[m[2].toLowerCase() as '' | 'k' | 'm' | 'g'];
}

function memLimit(bloco: string | undefined, servico: string): number {
  const m = bloco?.match(/^ {4}mem_limit:\s*(\S+)\s*$/m);
  assert.ok(m, `${servico} sem mem_limit`);
  return bytes(m[1]);
}

describe('limites de memória do docker-compose.servidor.yml (VM)', () => {
  const texto = readFileSync(SERVIDOR, 'utf8');
  const b = blocos(texto);
  const limites = { backend: memLimit(b.backend, 'backend'), db: memLimit(b.db, 'db'), clamav: memLimit(b.clamav, 'clamav') };

  it('a soma dos três cabe na memória livre da VM (~6 GiB)', () => {
    const soma = limites.backend + limites.db + limites.clamav;
    assert.ok(soma <= 6 * GIB, `soma ${(soma / GIB).toFixed(2)} GiB`);
  });

  it('o clamav fica acima do pico medido do clamd (2,7 GiB)', () => {
    assert.ok(limites.clamav > 2.7 * GIB, `clamav ${(limites.clamav / GIB).toFixed(2)} GiB`);
  });

  it('o heap do Node fica abaixo do mem_limit da API, com folga, e acima do pico do relatório no teto', () => {
    const m = b.backend.match(/NODE_OPTIONS=.*--max-old-space-size=(\d+)/);
    assert.ok(m, 'NODE_OPTIONS com --max-old-space-size no backend');
    const heap = Number(m[1]) * MIB;
    // Medido: ~0,45 GB fora do heap (Prisma, buffers) com 100 mil achados.
    assert.ok(limites.backend - heap >= 512 * MIB, 'pelo menos 512 MiB entre o heap e o mem_limit');
    // Medido: ~0,9 GB de heap com 50 mil achados; o heap precisa caber isso e o resto da API.
    assert.equal(TETO_ACHADOS_RELATORIO, 50_000, 'o teto mudou: medir de novo o pico e rever o heap');
    assert.ok(heap >= 1.25 * GIB, `heap ${heap / MIB} MiB acima do pico de ~0,9 GB com folga`);
  });
});
