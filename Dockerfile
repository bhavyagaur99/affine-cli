# affine-cli — a CLI, not a service. The image's entrypoint is the binary,
# so `docker run affine-cli doc list` reads exactly like `affine doc list`.
FROM node:22-alpine

# Non-root: nothing here needs privileges, and mounted workdirs stay clean.
RUN addgroup -S affine && adduser -S affine -G affine

WORKDIR /opt/affine-cli

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY bin ./bin
COPY src ./src
COPY scripts ./scripts

# /work is where mounted host files land (markdown in, exports out).
RUN mkdir -p /work && chown affine:affine /work
USER affine
WORKDIR /work

ENTRYPOINT ["node", "/opt/affine-cli/bin/affine.js"]
CMD ["--help"]
