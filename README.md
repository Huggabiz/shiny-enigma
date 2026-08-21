# Range Planner

## Working on a shared project file (check-out / check-in)

The tool supports multiple people taking turns on a single project
JSON stored in a shared location (network drive, OneDrive/SharePoint
folder).

**Requirements:** Chrome or Edge on desktop. Other browsers (Firefox,
Safari) fall back to "solo mode" — Load works, saving is a plain
download-style Save As, and there is no Save-in-place or check-out
locking. The toolbar shows a "⚠ Solo mode" badge when this applies.

**How it works**

- **Load** (Chrome/Edge) opens the file via a native picker and keeps
  a connection to it. The project opens **read-only**.
- **Check Out** claims the file: your name and a fresh timestamp are
  written into the file's `fileMeta.checkOut`, and editing unlocks.
  Colleagues opening the file see "🔒 <name> has this checked out"
  and stay read-only.
- **Save** writes back to the same file with no dialog and keeps your
  check-out. Before writing, the app silently re-reads the file and
  warns if someone else saved in the meantime (revision conflict).
- **Check In** saves and releases the lock in one step.
- **Stale locks:** while checked out, the app refreshes the lock
  timestamp every 5 minutes. If a lock hasn't been refreshed for
  15+ minutes (crashed browser, closed laptop), other users are
  offered a take-over when they press Check Out.
- **Identity** is a display name you enter once (stored in the
  browser, changeable by clearing site data). It is advisory
  courtesy, not security.

**OneDrive/SharePoint note:** the sync client adds a delay between a
save on one machine and the file updating on another. The revision
check catches most collisions, but two saves within the same sync
window can still produce a OneDrive "conflict copy" — if you see one,
open both and use Append to merge.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
