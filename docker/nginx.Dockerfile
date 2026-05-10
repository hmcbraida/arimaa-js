# Multi-stage Dockerfile for the static SPA fronted by nginx.
#
# Stage 1 ("build") uses Bun to install dependencies and run `bun run
# build`, which type-checks the TypeScript and produces a hashed,
# gzip-friendly bundle in `dist/`.
#
# Stage 2 ("runtime") starts from `nginx:alpine` and copies just the
# build output and our custom config. The runtime image is therefore
# tiny and contains no Node, no Bun, and no source -- only static
# assets and nginx itself.

FROM oven/bun:1.3.5-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy everything required by `vite build` and the type check.
COPY src ./src
COPY index.html ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.cjs ./

RUN bun run build:nocheck

# --- Runtime stage --------------------------------------------------

FROM nginx:1.27-alpine AS runtime

# Replace the default nginx config with one that knows about the
# SPA's `/api` and `/ws` proxy paths.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the static assets produced by the build stage. nginx serves
# them out of `/usr/share/nginx/html` by default.  The outer reverse
# proxy strips the public sub-path prefix before requests reach here,
# so the container always sees paths starting at /.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
