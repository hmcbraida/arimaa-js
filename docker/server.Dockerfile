# Dockerfile for the Arimaa session API server.
#
# We run TypeScript directly through Bun (no separate compile step)
# because Bun's native loader handles `.ts` and `.tsx` files end-to-end.
# That keeps the image simple — one binary, one entrypoint — and avoids
# the maintenance overhead of producing a separate `dist/server` build.
#
# The image takes the entire repository as build context. Only the
# files actually needed at runtime are copied in: package.json (so Bun
# can resolve dependencies), the source tree under `src`, and the
# Drizzle migration directory. Anything else listed in `.dockerignore`
# is excluded.

FROM oven/bun:1.3.5-alpine AS base
WORKDIR /app

# Install production dependencies. We intentionally use --frozen-lockfile
# so the image build is deterministic; if the lockfile is out of sync
# with package.json, the build fails loudly rather than silently
# diverging from the developer's local install.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the source needed at runtime.
#
# - `src/` for the engine, server, shared schemas, etc.
# - `tsconfig.json` so Bun's loader honours the project's compiler
#   options.
# - `drizzle.config.ts` is referenced indirectly by drizzle-kit; not
#   strictly needed at runtime but cheap to include.
COPY src ./src
COPY tsconfig.json ./
COPY drizzle.config.ts ./

# The HTTP port the server binds to. Matches the default in
# `src/server/index.ts` and is wired up in docker-compose.yml.
EXPOSE 3001

# `bun run` resolves the script from package.json and forwards env
# variables, so `DATABASE_URL` and `NATS_URL` from compose are visible
# to the process. Migrations run automatically before the server binds.
CMD ["bun", "run", "server"]
