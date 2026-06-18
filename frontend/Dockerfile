FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# servidor de desenvolvimento do Vite acessível fora do container
CMD ["npm", "run", "dev", "--", "--host"]
