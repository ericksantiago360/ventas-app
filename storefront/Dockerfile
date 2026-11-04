# Etapa 1: build con Vite (base /tienda/)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Etapa 2: servir la tienda en /tienda/ (Nginx del stack la enruta desde /tienda/)
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html/tienda
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
