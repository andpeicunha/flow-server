FROM docker.io/library/node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 3422
CMD ["node", "src/remote/production-server.mjs"]
