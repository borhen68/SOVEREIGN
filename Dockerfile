FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Install ALL dependencies (including dev) so we can build reproducibly
RUN npm ci

COPY . .

# Build the project
RUN npm run build

# Prune dev dependencies to keep image small
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/health').then(r => { if(!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["npm", "run", "start:prod"]
