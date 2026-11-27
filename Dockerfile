FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production TZ=America/Chicago DB_PATH=/data/csll.db
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
