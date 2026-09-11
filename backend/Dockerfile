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
RUN npx prisma generate \
 && sed -i 's/\r$//' docker-entrypoint.sh

# O SQLite fica em /data (volume no docker-compose.yml) para sobreviver a
# reinícios e rebuilds da imagem.
ENV DATABASE_URL=file:/data/dev.db
ENV PORT=8080
EXPOSE 8080

# Aplica o schema, semeia (demo só na primeira subida) e inicia a API.
CMD ["sh", "./docker-entrypoint.sh"]
