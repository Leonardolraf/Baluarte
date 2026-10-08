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

# Estágio 2: Nginx com fallback de SPA, proxy /api -> backend:8080 e, quando há certificado
# montado em /etc/nginx/certs, HTTPS na 443 (ver nginx/40-baluarte-tls.sh).
FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/baluarte /etc/nginx/certs
COPY nginx/*.conf /etc/nginx/baluarte/
COPY nginx/40-baluarte-tls.sh /docker-entrypoint.d/40-baluarte-tls.sh
RUN chmod 755 /docker-entrypoint.d/40-baluarte-tls.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
