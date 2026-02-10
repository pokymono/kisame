# Repository Guidelines

## Project Structure & Module Organization
- `electron/` contains the Electron main and preload entry points (`electron/main.ts`, `electron/preload.ts`).
- `src/` holds the renderer code. The UI layer lives in `src/ui/`, shared types in `src/types.ts`, and global styles in `src/index.css` (Tailwind v4).
- `public/` provides static assets loaded by the renderer.
- `index.html` is the renderer shell for Vite.
- Build outputs land in `dist/` (renderer) and `dist-electron/` (Electron bundles).

## Build, Test, and Development Commands
- `npm install` installs dependencies (Node.js 18+ required).
- `npm run dev` starts the Vite dev server and launches Electron via `vite-plugin-electron`.
- `npm run build` runs `tsc` and builds renderer/Electron bundles into `dist/` and `dist-electron/`.
- `npm run preview` serves the built renderer for a quick smoke check.

## Coding Style & Naming Conventions
- TypeScript with `strict` mode enabled (see `tsconfig.json`).
- Use 2-space indentation and semicolons (match existing files such as `src/main.ts`).
- File names follow kebab-case (examples: `app-shell.ts`, `streamdown-plugins.ts`).
- Styling is Tailwind-first; keep global styles in `src/index.css` and prefer utility classes in UI modules.

## Testing Guidelines
- No automated test runner is configured yet. Validate changes by running the app locally.
- If you introduce tests, add a script in `package.json` and document the framework and conventions here.

## Commit & Pull Request Guidelines
- Recent history mixes conventional commits (`feat: ...`) and sentence-case summaries. Prefer conventional commits going forward for consistency.
- PRs should include:
- A short summary of behavior changes.
- Repro or test steps (e.g., `npm run dev` + manual flows).
- Screenshots or short clips for UI changes.

## Configuration & Services
- `kisame.config.json` stores the backend URL used by the app.
- For local development, the explanation service must be running at `http://localhost:8787` (see `README.md`).
