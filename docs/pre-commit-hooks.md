# Pre-commit Hooks

This project uses [prek](https://github.com/j178/prek) to manage git pre-commit hooks.

## Hooks

Three hooks run automatically on every `git commit`:

| Hook | Command | What it checks |
|------|---------|----------------|
| `lint` | `bun run lint` | ESLint + Biome |
| `test` | `bun run test` | Bun unit tests |
| `test-ui` | `bun run test:ui` | Playwright UI tests |

## Setup

prek is installed as a dev dependency and the git shim is registered with `prek install`. New contributors need to run this once after cloning:

```bash
bun install
bunx prek install
```

## Running hooks manually

```bash
# Run all hooks
bunx prek run --all-files

# Run a specific hook
bunx prek run lint
bunx prek run test
bunx prek run test-ui
```

## Skipping hooks

To bypass hooks for a work-in-progress commit (use sparingly):

```bash
git commit --no-verify
```

## Configuration

Hooks are defined in [`prek.toml`](../prek.toml) at the project root.
