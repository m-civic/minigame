FROM node:24-bookworm
LABEL org.opencontainers.image.source="https://github.com/m-civic/minigame"
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node dist/backend/ ./
USER node
EXPOSE 10000
CMD ["node", "index.cjs"]
