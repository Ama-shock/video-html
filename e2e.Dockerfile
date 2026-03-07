FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci \
    && npx playwright install --with-deps chromium
