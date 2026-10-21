// Testes de UNIDADE do entrypoint do Docker (DT28), sem Docker nem banco: roda o
// docker-entrypoint.sh de verdade no `sh`, com `npx` e `npm` falsos no PATH (só registram a
// chamada num arquivo) e um diretório temporário no lugar do /data (DATA_DIR).
// Confere: seeds desligados por omissão, marcador de cada seed, recusa com SEMEAR_PROIBIDO=1
// ou NODE_ENV=production e a recusa antiga de DATABASE_URL que não é PostgreSQL.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ENTRYPOINT = resolve(import.meta.dirname, '../../docker-entrypoint.sh');
const DATABASE_URL = 'postgresql://baluarte:x@db:5432/baluarte?schema=public';

// No Windows o `sh` é o do Git; em Linux/macOS, o do sistema.
function acharSh(): string | null {
  const candidatos = process.platform === 'win32'
    ? ['C:/Program Files/Git/usr/bin/sh.exe', 'C:/Program Files/Git/bin/sh.exe', 'sh']
    : ['sh'];
  for (const c of candidatos) {
    const r = spawnSync(c, ['-c', 'exit 0']);
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
const SH = acharSh();

// Caminho com barras normais: o sh do Git aceita `C:/...`, não `C:\...` em todo lugar.
const barra = (p: string) => p.replace(/\\/g, '/');

let raiz = '';
let stubs = '';
let contador = 0;

before(() => {
  raiz = mkdtempSync(join(tmpdir(), 'entrypoint-'));
  stubs = join(raiz, 'bin');
  mkdirSync(stubs);
  // `npx`/`npm` falsos: registram a linha de comando; `npm` falha se FALHAR_NPM=1.
  writeFileSync(join(stubs, 'npx'), '#!/bin/sh\necho "npx $*" >> "$REGISTRO"\n', { mode: 0o755 });
  writeFileSync(join(stubs, 'npm'), '#!/bin/sh\necho "npm $*" >> "$REGISTRO"\n[ "${FALHAR_NPM:-0}" = "1" ] && exit 7\nexit 0\n', { mode: 0o755 });
});
after(() => { if (raiz) rmSync(raiz, { recursive: true, force: true }); });

function novoData(): string {
  const d = join(raiz, `data-${++contador}`);
  mkdirSync(d);
  return d;
}

interface Subida { status: number | null; chamadas: string[]; stderr: string }

function subir(dataDir: string, extra: Record<string, string> = {}): Subida {
  const registro = join(raiz, `registro-${++contador}.txt`);
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of ['SEED_CONTRATO', 'SEED_DEMO', 'SEMEAR_PROIBIDO', 'NODE_ENV', 'JWT_SECRET', 'FALHAR_NPM']) delete env[k];
  Object.assign(env, {
    DATABASE_URL,
    DATA_DIR: barra(dataDir),
    REGISTRO: barra(registro),
    STUBS: barra(stubs),
    ENTRYPOINT: barra(ENTRYPOINT),
    ...extra,
  });
  // O PATH vai montado dentro do sh (no Windows o PATH do Node usa `;` e `C:`).
  const r = spawnSync(SH!, ['-c', 'PATH="$(cd "$STUBS" && pwd):$PATH"; export PATH; exec sh "$ENTRYPOINT"'], { env, encoding: 'utf8' });
  const chamadas = existsSync(registro) ? readFileSync(registro, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, chamadas, stderr: r.stderr };
}

const seeds = (s: Subida) => s.chamadas.filter((c) => c.startsWith('npm '));

describe('docker-entrypoint.sh: seeds (DT28)', { skip: SH ? false : 'sh não encontrado nesta máquina' }, () => {
  it('sem variáveis, nenhum seed roda: só migrations e a API', () => {
    const s = subir(novoData());
    assert.equal(s.status, 0, s.stderr);
    assert.deepEqual(s.chamadas, ['npx prisma migrate deploy', 'npx tsx src/server.ts']);
  });

  it('SEED_CONTRATO=1 roda o seed uma vez; na segunda subida o marcador impede', () => {
    const data = novoData();
    const primeira = subir(data, { SEED_CONTRATO: '1' });
    assert.equal(primeira.status, 0, primeira.stderr);
    assert.deepEqual(seeds(primeira), ['npm run --silent seed']);
    assert.ok(existsSync(join(data, '.seed-contrato-ok')));
    assert.ok(!existsSync(join(data, '.seed-demo-ok')), 'SEED_DEMO continua desligado');

    const segunda = subir(data, { SEED_CONTRATO: '1' });
    assert.equal(segunda.status, 0, segunda.stderr);
    assert.deepEqual(seeds(segunda), []);
    assert.ok(segunda.chamadas.includes('npx tsx src/server.ts'));
  });

  it('SEED_DEMO=1 também tem marcador próprio', () => {
    const data = novoData();
    assert.deepEqual(seeds(subir(data, { SEED_DEMO: '1' })), ['npm run --silent seed:demo']);
    assert.deepEqual(seeds(subir(data, { SEED_DEMO: '1' })), []);
  });

  it('seed de contrato que falha derruba a subida e não grava o marcador', () => {
    const data = novoData();
    const s = subir(data, { SEED_CONTRATO: '1', FALHAR_NPM: '1' });
    assert.notEqual(s.status, 0);
    assert.ok(!existsSync(join(data, '.seed-contrato-ok')));
    assert.ok(!s.chamadas.includes('npx tsx src/server.ts'), 'a API não sobe');
  });

  it('SEMEAR_PROIBIDO=1 com SEED_CONTRATO=1 recusa antes de tocar no banco', () => {
    const s = subir(novoData(), { SEMEAR_PROIBIDO: '1', SEED_CONTRATO: '1' });
    assert.notEqual(s.status, 0);
    assert.match(s.stderr, /seed recusado/);
    assert.deepEqual(s.chamadas, [], 'nem migration, nem seed, nem API');
  });

  it('NODE_ENV=production com SEED_DEMO=1 recusa', () => {
    const s = subir(novoData(), { NODE_ENV: 'production', SEED_DEMO: '1' });
    assert.notEqual(s.status, 0);
    assert.match(s.stderr, /seed recusado/);
    assert.deepEqual(s.chamadas, []);
  });

  it('SEMEAR_PROIBIDO=1 sem seed pedido sobe normalmente (caso da VM)', () => {
    const s = subir(novoData(), { SEMEAR_PROIBIDO: '1', SEED_CONTRATO: '0', SEED_DEMO: '0', NODE_ENV: 'production' });
    assert.equal(s.status, 0, s.stderr);
    assert.deepEqual(s.chamadas, ['npx prisma migrate deploy', 'npx tsx src/server.ts']);
  });

  it('DATABASE_URL que não é PostgreSQL continua recusado', () => {
    const s = subir(novoData(), { DATABASE_URL: 'file:./dev.db' });
    assert.notEqual(s.status, 0);
    assert.match(s.stderr, /DATABASE_URL deve apontar para o PostgreSQL/);
    assert.deepEqual(s.chamadas, []);
  });
});
