FROM node:20-alpine
# Os engines do Prisma precisam da libssl; o Alpine não a traz por padrão
# ("Prisma failed to detect the libssl/openssl version" no db push/generate).
RUN apk add --no-cache openssl
WORKDIR /app

# dependências (cacheável; usa o lockfile)
COPY package*.json ./
RUN npm ci

# código + Prisma Client
COPY . .
RUN npx prisma generate
# o entrypoint roda no sh do Alpine: garante LF mesmo se o checkout veio com CRLF
RUN sed -i 's/\r$//' docker-entrypoint.sh

# Os dados ficam no PostgreSQL (serviço db do compose; DATABASE_URL vem do ambiente).
# /data (volume) guarda só o JWT_SECRET gerado, os marcadores dos seeds (DT28) e as senhas
# geradas pelo seed:demo (DT32). O backup da VM é pg_dump do banco: não leva o /data.
# NODE_ENV vem do compose (development por padrão).
ENV PORT=8080
# DT32: o seed:demo grava as senhas aleatórias da demonstração no volume, ao lado do jwt.secret
# (vale também para `docker compose exec backend npm run seed:demo`). É só o caminho, não segredo.
ENV SENHAS_DEMO_ARQUIVO=/data/senhas-demo.txt

# A API não precisa de root. /data já nasce do usuário `node` para que o volume
# nomeado herde o dono na primeira montagem (volume antigo criado como root:
# `docker compose down -v` recria, ou ajuste o dono manualmente).
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 8080

# Aplica as migrations, semeia só se SEED_CONTRATO/SEED_DEMO=1 (uma vez por volume) e inicia a API.
CMD ["sh", "./docker-entrypoint.sh"]
