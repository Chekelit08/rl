# TURBOGOL: juego + servidor online en un solo contenedor.
# El servidor (Node, autoritativo a 120 Hz) sirve dist/ y el WebSocket en /ws del mismo puerto.
#   docker build -t turbogol .
#   docker run --rm -p 8787:8787 -e PORT=8787 turbogol      → http://localhost:8787

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# El servidor corre la misma simulación TypeScript que el navegador (Node quita los tipos al cargar)
COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "--experimental-strip-types", "--no-warnings", "server/main.ts"]
