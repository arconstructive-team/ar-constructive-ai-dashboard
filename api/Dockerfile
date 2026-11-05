# The arconstructive API on Cloud Run: the permit check and the team chat assistant.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY tsconfig.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/main.ts"]
