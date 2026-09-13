# Quest Platform

## О проекте

Quest Platform — развиваемый mobile-first PWA для создания и прохождения квестов в реальном мире. Приложение поддерживает GPS-проверки, коды и ответы, задания с медиа, статистику, скачивание квестов, хранение данных в IndexedDB, офлайн-прохождение и последующую синхронизацию.

Проект находится в состоянии стабильного развиваемого MVP. Его не следует считать полностью production-ready без дополнительного усиления серверной безопасности, проверок авторизованных сценариев и миграций.

## Возможности

### Организатор

- создание и редактирование квестов;
- управление заданиями и их порядком;
- настройка GPS, кодов, ответов, подсказок и медиа;
- управление доступностью и лимитами попыток;
- выдача доступа участникам по персональному приглашению, общей ссылке или
  короткому коду;
- просмотр статистики;
- копирование и публикация ссылок на квесты.

### Участник

- получение доступа к закрытому квесту по приглашению, ссылке или короткому коду;
- прохождение квестов с GPS- и кодовой проверкой;
- работа с заданиями и подсказками;
- скачивание квестов;
- офлайн-прохождение с хранением результатов в IndexedDB;
- синхронизация накопленных результатов после восстановления сети.

## Технологии

- React 19;
- Vite 8;
- React Router 7;
- Supabase Auth и Supabase JavaScript Client;
- IndexedDB через `idb`;
- Leaflet и React Leaflet;
- Tailwind CSS 4;
- `vite-plugin-pwa` и Workbox;
- Vitest и React Testing Library;
- Playwright;
- Oxlint;
- GitHub Actions;
- Dependabot;
- CodeQL Default Setup, secret scanning и Codex Review в GitHub.

## Требования

- Git;
- Node.js 22.22.2 или новее; локальная и Cloudflare-среды используют Node 22.23.0, а в CI — актуальную версию ветки 22.x;
- npm.

## Быстрый старт

```bash
git clone https://github.com/Adoms17/quest-platform.git
cd quest-platform
```

Создайте локальный файл окружения.

PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Bash:

```bash
cp .env.example .env.local
```

Заполните тестовыми или проектными публичными значениями, затем установите зависимости и запустите приложение:

```bash
npm ci
npm run dev
```

Vite обычно открывает приложение по адресу `http://localhost:5173`. Если порт занят, будет выбран другой свободный порт; используйте адрес из вывода команды.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | Публичный anon/publishable key Supabase |
| `VITE_GEOAPIFY_API_KEY` | Публичный Geoapify key с ограничением по доменам для подготовки статических offline-карт; необязателен |

Все переменные `VITE_*` включаются в клиентский bundle и доступны пользователю. Во frontend допустимы только публичные ключи, ограниченные разрешёнными доменами. Использование `service_role` key во frontend запрещено.

Конфиденциальность и разграничение доступа обеспечиваются серверными RPC и политиками Supabase RLS. Репозиторий содержит версионируемые миграции и pgTAP-тесты политик, приватности, серверной проверки и идемпотентности. Соответствие реально развёрнутой схемы конкретному окружению проверяется отдельным `inspect`/`dry-run` перед публикацией миграций.

Файл `.env.local` локальный и не должен попадать в Git.

## Команды

| Команда | Назначение |
|---|---|
| `npm run dev` | Запуск Vite dev server |
| `npm run build` | Production-сборка в `dist` |
| `npm run preview` | Локальный просмотр production-сборки |
| `npm run lint` | Проверка Oxlint |
| `npm test` | Однократный запуск Vitest |
| `npm run test:watch` | Vitest в watch-режиме |
| `npm run test:e2e` | Playwright smoke tests |
| `npm run test:e2e:ui` | Playwright в UI-режиме |

Перед первым E2E-запуском установите Chromium:

```bash
npx playwright install chromium
```

В корпоративной сети с собственным центром сертификации может потребоваться `NODE_USE_SYSTEM_CA=1` для текущей сессии. Не отключайте npm `strict-ssl`.

## Тестирование

Проект содержит:

- unit/component tests на Vitest и React Testing Library;
- регрессионные тесты стабильности React-эффектов;
- тест `LazyRouteErrorBoundary` для rejected lazy import;
- Playwright smoke tests прямого открытия и редиректов маршрутов в Chromium.

E2E запускают production-сборку с тестовыми значениями Supabase, не используют рабочий Supabase и не проверяют настоящую регистрацию или авторизацию.

## Сборка и PWA

Маршрутные страницы загружаются через `React.lazy`, поэтому production-сборка разделяется на чанки. Результат `npm run build` создаётся в `dist`.

`vite-plugin-pwa` генерирует service worker с режимом `autoUpdate`; Workbox добавляет подходящие статические ресурсы в precache. `LazyRouteErrorBoundary` обрабатывает ошибку загрузки устаревшего hashed-чанка и предлагает пользователю перезагрузить приложение. Для production PWA требуется HTTPS, за исключением стандартных локальных development-сценариев.

## CI и безопасность

Подтверждённый pipeline job `validate` выполняет:

```text
npm ci → npm audit --audit-level=high → lint → Vitest → build → установка Chromium → Playwright
```

Dependabot настроен файлами репозитория для npm и GitHub Actions. В настройках GitHub включён общий ruleset для `main` и `staging`: pull request, squash merge, линейная история, обязательная проверка `validate`, CodeQL, запрет удаления и force-push. Для GitHub Environment `production` дополнительно требуется ручное подтверждение; оба окружения принимают deployment только из защищённых веток. Secret scanning/push protection и Codex Review проверяются отдельно, поскольку эти настройки не версионируются вместе с кодом.

## Структура проекта

```text
src/pages       маршрутные страницы
src/components  переиспользуемые UI-компоненты и Error Boundary
src/services    IndexedDB и синхронизация
src/test        общая настройка Vitest
e2e             Playwright smoke tests
public          статические PWA-ресурсы
.github         CI и Dependabot
docs            архитектура проекта
```

## Рабочий процесс

Рекомендуемый процесс: feature branch → локальные проверки → pull request в `staging` → staging deploy и smoke → pull request `staging` → `main` → ручное подтверждение production deployment → squash merge. Правила merge и branch protection задаются настройками GitHub.

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Подробная документация в Notion](https://app.notion.com/p/3bc511103a9a811996feff01bcc586d6)
- [Правила работы агента](AGENTS.md)

## Статус

Стабильный развиваемый MVP с миграциями Supabase, RLS/pgTAP-тестами и раздельными frontend-окружениями. Фазы доступа 1–5 функционально закрыты, мобильный Gate E и stage smoke приняты. Авторизованные participant, offline/recovery и group-management E2E реализованы; production rollout текущей версии выполняется отдельно по защищённому процессу. Актуальный план и статусы ведутся в [Notion](https://app.notion.com/p/3d7511103a9a8109b25fc84f9611ee79).
