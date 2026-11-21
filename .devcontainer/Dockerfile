# Node matches package.json's volta pin. The digest is the multi-arch index, so amd64 and arm64 hosts both resolve it.
# Trixie, not bookworm: Shared Memory runs `git worktree add --orphan`, which needs git 2.42 or later.
FROM node:26.9.0-trixie@sha256:fa271c47a5d81dc321f4a45be01362f5b3de7559edc7e76b8c4089be1e50d866

# Same gitleaks version and SHA-256 as ci.yml's gitleaks job; bump all three together.
ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256_AMD64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARG GITLEAKS_SHA256_ARM64=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080

# pnpm matches package.json's packageManager pin. Node 25 and later ship without corepack, so the release
# binary is installed directly, kept beside the dist/ folder it loads at runtime.
ARG PNPM_VERSION=12.15.0
ARG PNPM_SHA256_AMD64=55b5ed0092bd11176c1669598e231ae52e7cedac59de6efd0d415730f37d0598
ARG PNPM_SHA256_ARM64=d7ce93a2c7d847d3a34bd3f559b60c14f578b1320c17cc352a2c5c5fdf956117

RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) gitleaks_asset=linux_x64; gitleaks_sha="$GITLEAKS_SHA256_AMD64"; pnpm_asset=x64; pnpm_sha="$PNPM_SHA256_AMD64" ;; \
      arm64) gitleaks_asset=linux_arm64; gitleaks_sha="$GITLEAKS_SHA256_ARM64"; pnpm_asset=arm64; pnpm_sha="$PNPM_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 -o /tmp/gitleaks.tar.gz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${gitleaks_asset}.tar.gz"; \
    echo "$gitleaks_sha  /tmp/gitleaks.tar.gz" | sha256sum -c --quiet -; \
    tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks; \
    rm /tmp/gitleaks.tar.gz; \
    curl -fsSL --retry 3 -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-${pnpm_asset}.tar.gz"; \
    echo "$pnpm_sha  /tmp/pnpm.tar.gz" | sha256sum -c --quiet -; \
    mkdir -p /opt/pnpm; \
    tar -xzf /tmp/pnpm.tar.gz -C /opt/pnpm; \
    rm /tmp/pnpm.tar.gz; \
    ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm; \
    apt-get update; \
    apt-get install -y --no-install-recommends ripgrep fd-find jq; \
    ln -s "$(command -v fdfind)" /usr/local/bin/fd; \
    rm -rf /var/lib/apt/lists/*

# Pre-created so the node_modules named volume inherits the node user's ownership on first mount.
RUN mkdir -p /workspaces/raiminiscence/node_modules && chown -R node:node /workspaces
