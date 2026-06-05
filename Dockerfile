FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app


COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

ENV VAULT_PATH=/vault
ENV STATE_DIR=/state

ENTRYPOINT ["npm", "start", "--"]
CMD ["--watch", "all"]
