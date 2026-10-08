#!/bin/sh
# Entrypoint da API no Docker.
#  - JWT_SECRET: se não vier do ambiente, gera um aleatório e guarda no volume /data
#    (tokens continuam válidos entre reinícios; nada de segredo fixo na imagem);
#  - aplica as migrations no PostgreSQL (`migrate deploy`: só aplica o que falta, nunca apaga);
#  - `seed` sempre (upserts: garante os usuários/ativos/departamentos do contrato da N2 AT1);
#  - `seed:demo` só na PRIMEIRA subida bem-sucedida (marcador em /data;
#    SEED_DEMO=0 desliga), para não apagar o que foi criado pela interface.
set -e

case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*) ;;
  *) echo "[entrypoint] DATABASE_URL deve apontar para o PostgreSQL (postgresql://...)" >&2; exit 1 ;;
esac

DATA_DIR=/data
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

npx prisma migrate deploy

# SEED_CONTRATO=0 desliga o seed de contrato: ele cria admin/analista/colaborador com as
# senhas publicas do README (as suites Newman/Robot precisam delas). Em producao, com
# banco proprio, as contas vem da migracao dos dados ou do convite, nunca de senha publica.
if [ "${SEED_CONTRATO:-1}" = "1" ]; then
  npm run --silent seed
fi

MARCADOR="$DATA_DIR/.seed-demo-ok"
if [ "${SEED_DEMO:-1}" = "1" ] && [ ! -f "$MARCADOR" ]; then
  npm run --silent seed:demo && touch "$MARCADOR"
fi

exec npx tsx src/http/server.ts
