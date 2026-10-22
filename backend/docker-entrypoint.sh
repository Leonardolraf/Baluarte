#!/bin/sh
# Entrypoint da API no Docker.
#  - JWT_SECRET: se não vier do ambiente, gera um aleatório e guarda no volume /data
#    (tokens continuam válidos entre reinícios; nada de segredo fixo na imagem);
#  - aplica as migrations no PostgreSQL (`migrate deploy`: só aplica o que falta, nunca apaga);
#  - seeds DESLIGADOS por omissão (DT28). Só rodam se pedidos explicitamente, e cada um só
#    na PRIMEIRA subida bem-sucedida com aquele volume /data (marcador próprio):
#      SEED_CONTRATO=1 -> `seed` (admin/analista/colaborador com as senhas públicas do README,
#                         ativos e departamentos do contrato da N2 AT1; Newman/Robot precisam dele);
#      SEED_DEMO=1     -> `seed:demo` (dados de demonstração; faz deleteMany e recria contas
#                         com senhas aleatórias novas, gravadas em $DATA_DIR/senhas-demo.txt,
#                         ao lado do jwt.secret: nada de senha fixa na imagem, DT32).
#  - SEMEAR_PROIBIDO=1 ou NODE_ENV=production com qualquer SEED_*=1: recusa subir (exit 1).
set -e

case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*) ;;
  *) echo "[entrypoint] DATABASE_URL deve apontar para o PostgreSQL (postgresql://...)" >&2; exit 1 ;;
esac

SEED_CONTRATO="${SEED_CONTRATO:-0}"
SEED_DEMO="${SEED_DEMO:-0}"

# Trava dos seeds fora do ambiente local (DT28). O seed de contrato faz upsert por e-mail
# @empresa.com com `update: {}` e, no create, ids FIXOS (u-000, u-001, u-002; prisma/seed.ts):
#  - banco novo ou vazio: CRIA as contas com as senhas públicas do README (motivo do padrão 0);
#  - banco que já tem esses ids com outro e-mail (a produção, contas @baluarte.test de 07/10):
#    violação de chave primária, o seed lança, o set -e derruba o script e a API NÃO sobe.
# Nos dois casos, recusar aqui com mensagem clara é melhor que seguir.
# Não dá para travar pelo host do DATABASE_URL: na VM de produção o banco também é `db`
# (docker-compose.servidor.yml), igual ao compose local. Por isso a trava é explícita.
if [ "$SEED_CONTRATO" = "1" ] || [ "$SEED_DEMO" = "1" ]; then
  if [ "${SEMEAR_PROIBIDO:-0}" = "1" ] || [ "${NODE_ENV:-}" = "production" ]; then
    echo "[entrypoint] seed recusado: SEED_CONTRATO=$SEED_CONTRATO SEED_DEMO=$SEED_DEMO com SEMEAR_PROIBIDO=${SEMEAR_PROIBIDO:-0} NODE_ENV=${NODE_ENV:-}. O seed de contrato cria contas com as senhas públicas do README e o seed:demo apaga e recria dados; neste ambiente use SEED_CONTRATO=0 e SEED_DEMO=0" >&2
    exit 1
  fi
fi

# DATA_DIR sobrescrevível só para o teste do entrypoint (tests/unidade/entrypoint.test.ts).
DATA_DIR="${DATA_DIR:-/data}"
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

# Seed de contrato: só com SEED_CONTRATO=1 e só uma vez por volume. Se falhar, o set -e
# derruba a subida e o marcador não é criado (a próxima subida tenta de novo).
MARCADOR_CONTRATO="$DATA_DIR/.seed-contrato-ok"
if [ "$SEED_CONTRATO" = "1" ] && [ ! -f "$MARCADOR_CONTRATO" ]; then
  npm run --silent seed
  touch "$MARCADOR_CONTRATO"
fi

MARCADOR="$DATA_DIR/.seed-demo-ok"
if [ "$SEED_DEMO" = "1" ] && [ ! -f "$MARCADOR" ]; then
  # DT32: as senhas da demonstração vão para o volume, nunca para a imagem nem para o log.
  SENHAS_DEMO_ARQUIVO="$DATA_DIR/senhas-demo.txt" npm run --silent seed:demo && touch "$MARCADOR"
fi

exec npx tsx src/server.ts
