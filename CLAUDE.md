# CLAUDE.md

Project-specific guidance for Claude Code sessions on this repo.

## Versioning

- **Always bump `package.json` `version` before every commit.** Default to a
  patch bump (e.g. `1.5.1` → `1.5.2`). Use minor/major only when the user
  explicitly asks or the change warrants it. The user expects this on every
  commit, including config/docs changes, so they can tell from the toolbar
  badge which build is live.
- The app displays `APP_VERSION` in the toolbar, sourced from `package.json` via
  Vite's `define` in `vite.config.ts`. A bump is the only way the user can tell a
  new build is live.

## Branching & Deploy

- Feature work happens on `claude/setup-new-repository-Wv58I` (per session
  instructions).
- **GitHub Pages only deploys from `main`** (see `.github/workflows/deploy.yml`).
  Pushing to the feature branch alone will NOT update what the user sees on
  refresh.
- After pushing completed work to the feature branch, also fast-forward `main`
  so the deploy fires:
  ```
  git push origin claude/setup-new-repository-Wv58I:main
  ```
  This matches the user's existing workflow — prior releases (v1.4.x, v1.5.0)
  all landed directly on `main`.
- Only do this for work the user has signed off on. Do NOT auto-deploy
  speculative or in-progress changes.

## Build / Verify

- `npm run build` runs `tsc -b && vite build`. Run it before committing UI
  changes to catch type errors and confirm the bundle builds.
