# Сайт Квесты

## Accepted landing decisions
- Use selected visual option 1 as the base.
- Audience label: «Мероприятия и праздники», including the AI interest form.
- Public demo has three sequential example tasks: choice, text riddle, code; final result and restart.
- Step 2 explains the service editor and opens a participant example; it must not imply the landing contains an editor.
- Сайт независим от приложения. Согласован перенос в отдельный проект Cloudflare: qvesta.ru для production, stage-www.qvesta.ru для stage. Лендинги становятся отдельными страницами сайта. Дизайн и демо сохраняются.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
