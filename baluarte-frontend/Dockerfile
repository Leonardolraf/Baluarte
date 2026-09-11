# Baluarte — frontend (SPA React) servido por Nginx.
# Estágio 1: build de produção (sem mocks: VITE_USE_MOCKS vazio).
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# A API fica em /api (mesma origem); o Nginx encaminha para o serviço backend.
ENV VITE_API_BASE_URL=/api
ENV VITE_USE_MOCKS=
RUN npm run build

# Estágio 2: Nginx com fallback de SPA e proxy /api -> backend:8080.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
