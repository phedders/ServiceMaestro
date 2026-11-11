FROM node:24-trixie AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates tzdata git git-lfs openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 10001 wlm \
  && useradd -u 10001 -g wlm -M -s /usr/sbin/nologin wlm

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/control/dist ./packages/control/dist
COPY --from=build /app/packages/display ./packages/display

ENV NODE_ENV=production \
    WLM_HOST=0.0.0.0 \
    WLM_PORT=8080 \
    WLM_DATA_DIR=/data

RUN mkdir -p /data && chown 10001:10001 /data
USER 10001:10001
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
