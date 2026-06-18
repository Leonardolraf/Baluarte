FROM node:20-alpine
WORKDIR /app

# dependências (cacheável)
COPY package*.json ./
RUN npm install

# código
COPY . .
RUN npx prisma generate

EXPOSE 8080

# cria o schema no SQLite, popula (contrato + demo) e sobe a API
CMD ["sh", "-c", "npx prisma db push && npm run seed && npm run seed:demo && npm run start"]
