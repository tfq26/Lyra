FROM node:22-bookworm-slim

ARG INSTALL_ANTIGRAVITY=false
ARG INSTALL_CODEX=false
ARG INSTALL_CLAUDE=false
ARG INSTALL_OPENCODE=false

ENV DEBIAN_FRONTEND=noninteractive \
    BUN_INSTALL=/root/.bun \
    PATH=/root/.bun/bin:/root/.local/bin:$PATH \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash curl ca-certificates git ripgrep procps python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global bun \
    && if [ "$INSTALL_ANTIGRAVITY" = "true" ]; then \
      curl -fsSL https://antigravity.google/cli/install.sh | bash; \
    fi \
    && if [ "$INSTALL_CODEX" = "true" ]; then npm install --global @openai/codex; fi \
    && if [ "$INSTALL_CLAUDE" = "true" ]; then npm install --global @anthropic-ai/claude-code; fi \
    && if [ "$INSTALL_OPENCODE" = "true" ]; then npm install --global opencode-ai; fi

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install || npm install --include=dev --legacy-peer-deps --no-audit --no-fund
ARG CACHEBUST=1
COPY . .

RUN mkdir -p /workspace /data/lyra /root/.gemini /root/.codex /root/.claude /root/.config/opencode
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

CMD ["bun", "run", "/app/server/index.ts"]
