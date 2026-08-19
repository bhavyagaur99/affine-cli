# affine-cli — a CLI, not a service. The image's entrypoint is the binary,
# so `docker run affine-cli doc list` reads exactly like `affine doc list`.

# Dependencies are installed on the BUILD platform, never under emulation.
# The tree is pure JavaScript with no native addons, so the result is
# architecture-independent and safe to copy into any target image. Running
# `npm ci` under QEMU instead crashes Node with SIGILL (exit 132).
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /opt/affine-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine

# Non-root: nothing here needs privileges, and mounted workdirs stay clean.
RUN addgroup -S affine && adduser -S affine -G affine

WORKDIR /opt/affine-cli
COPY --from=deps /opt/affine-cli/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY scripts ./scripts

# /work is where mounted host files land (markdown in, exports out).
# /config holds the session written by `affine login`. Creating it here, owned
# by the runtime user, means a fresh named volume mounted at /config inherits
# that ownership -- otherwise Docker creates it root-owned and login cannot write.
RUN mkdir -p /work /config && chown affine:affine /work /config
ENV AFFINE_CLI_HOME=/config
USER affine
WORKDIR /work

ENTRYPOINT ["node", "/opt/affine-cli/bin/affine.js"]
CMD ["--help"]
