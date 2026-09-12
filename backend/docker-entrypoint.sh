#!/bin/sh
# Entrypoint da API no Docker.
#  - JWT_SECRET: se não vier do ambiente, gera um aleatório e guarda no volume
#    (tokens continuam válidos entre reinícios; nada de segredo fixo na imagem);
#  - aplica o schema Prisma no SQLite do volume (/data) — idempotente;
#  - `seed` sempre (upserts: garante os usuários/ativos do contrato da N2 AT1);
#  - `seed:demo` só na PRIMEIRA subida bem-sucedida (marcador em /data;
#    SEED_DEMO=0 desliga), para não apagar o que foi criado pela interface.
set -e

# O Prisma resolve caminhos relativos a partir de prisma/, então no container o
# DATABASE_URL tem de ser absoluto — senão o banco iria para outro lugar e a
# detecção de primeira subida olharia o arquivo errado.
case "${DATABASE_URL:-}" in
  file:/*) ;;
  *) echo "[entrypoint] DATABASE_URL deve ser um caminho absoluto (file:/data/dev.db); recebi '${DATABASE_URL:-vazio}'" >&2; exit 1 ;;
esac

DB_PATH="${DATABASE_URL#file:}"
DATA_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DATA_DIR"

if [ -z "${JWT_SECRET:-}" ]; then
  if [ ! -f "$DATA_DIR/jwt.secret" ]; then
    head -c 48 /dev/urandom | base64 | tr -d '\n' > "$DATA_DIR/jwt.secret"
    chmod 600 "$DATA_DIR/jwt.secret"
    echo "[entrypoint] JWT_SECRET gerado em $DATA_DIR/jwt.secret"
  fi
  JWT_SECRET="$(cat "$DATA_DIR/jwt.secret")"
  export JWT_SECRET
fi

# Mudanças destrutivas de schema exigem --accept-data-loss: prefira rodar à mão
# (`docker compose run --rm backend npx prisma db push --accept-data-loss`) a perder dados sem querer.
npx prisma db push --skip-generate
npm run --silent seed

MARCADOR="$DATA_DIR/.seed-demo-ok"
if [ "${SEED_DEMO:-1}" = "1" ] && [ ! -f "$MARCADOR" ]; then
  npm run --silent seed:demo && touch "$MARCADOR"
fi

exec npx tsx src/server.ts
