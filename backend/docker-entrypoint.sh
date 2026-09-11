#!/bin/sh
# Entrypoint da API no Docker.
#  - aplica o schema Prisma no SQLite do volume (/data) — idempotente;
#  - `seed` sempre (upserts: garante os usuários/ativos do contrato da N2 AT1);
#  - `seed:demo` só na PRIMEIRA subida (SEED_DEMO=0 desliga), para não apagar
#    o que foi criado pela interface nas subidas seguintes.
set -e

DB_PATH="${DATABASE_URL#file:}"
mkdir -p "$(dirname "$DB_PATH")"
if [ -f "$DB_PATH" ]; then FIRST_RUN=0; else FIRST_RUN=1; fi

npx prisma db push --skip-generate
npm run --silent seed
if [ "$FIRST_RUN" = "1" ] && [ "${SEED_DEMO:-1}" = "1" ]; then
  npm run --silent seed:demo
fi

exec npx tsx src/server.ts
