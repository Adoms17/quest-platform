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
- просмотр статистики;
- копирование и публикация ссылок на квесты.

### Участник

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
- Tailwind CSS 3;
- `vite-plugin-pwa` и Workbox;
- Vitest и React Testing Library;
- Playwright;
- Oxlint;
- GitHub Actions;
- Dependabot;
- CodeQL Default Setup, secret scanning и Codex Review в GitHub.

## Требования

- Git;
- Node.js 22.12.0 или новее; в CI используется актуальная версия ветки 22.x;
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

Все переменные `VITE_*` включаются в клиентский bundle и доступны пользователю. Во frontend допустим только anon/publishable key. Использование `service_role` key во frontend запрещено.

Конфиденциальность и разграничение доступа должны обеспечиваться серверными проверками и политиками Supabase RLS. Наличие корректных production-политик RLS текущим репозиторием не подтверждается: миграции и тесты RLS в нём отсутствуют.

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

Dependabot настроен файлами репозитория для npm и GitHub Actions. В настройках GitHub также включены ruleset для `main`, обязательная проверка `validate`, CodeQL Default Setup, secret scanning/push protection и Codex Review. Эти настройки не версионируются вместе с кодом, поэтому перед production-релизом их состояние необходимо проверять отдельно.

## Структура проекта

```text
src/pages       маршрутные страницы
src/components  переиспользуемые UI-компоненты и Error Boundary
src/services    IndexedDB и синхронизация
src/test        общая настройка Vitest
e2e             Playwright smoke tests
public          статические PWA-ресурсы
.github         CI и Dependabot
docs            архитектура и развёртывание
```

## Рабочий процесс

Рекомендуемый процесс: feature branch → локальные проверки → pull request → Codex Review → squash merge. Фактические правила merge и branch protection задаются настройками GitHub.

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Развёртывание](docs/DEPLOYMENT.md)
- [Правила работы агента](AGENTS.md)

## Статус

Стабильный развиваемый MVP, требующий дальнейшего усиления серверной безопасности, тестов авторизованных сценариев, миграций Supabase, тестов RLS и безопасных миграций IndexedDB.
