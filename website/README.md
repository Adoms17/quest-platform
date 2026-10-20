# Квеста — сайт

Независимый сайт по первому выбранному макету. Лендинги для аудиторий и кампаний будут отдельными страницами сайта.

## Запуск
`npm run dev -- --host 127.0.0.1 --port 4183 --strictPort`

## Реализовано
- Первый экран с фотографией библиотеки и иллюстрацией телефона.
- Демо-задание в диалоге, повтор ответа и переход к созданию квеста.
- Три шага, поле темы, пояснения к компонентам квеста.
- Раскрываемые сценарии для трёх аудиторий.
- Будущая ИИ-генерация; демонстрационная форма без отправки данных.

Создание квеста и вход по коду ведут на `https://app.qvesta.ru` (пути `/quests/new` и `/access/code`). Сборка с `--mode staging` ведёт на `https://stage.qvesta.ru`. Демонстрационные ответы сайта не связаны с приватными заданиями сервиса.

## Cloudflare
Отдельный Worker `qvesta-website`, stage — `qvesta-website-stage`. Корневая папка сборки — `website`. Production: `npm run build`, публикация `npx wrangler deploy`. Stage: `npm run build:stage`, публикация `npx wrangler deploy --env staging`.

Wrangler перед публикацией сам выполняет сборку выбранной среды и проверку адресов в готовом JavaScript. Поэтому оставшийся в dist результат другой среды пересобирается, а ошибка проверки останавливает публикацию. Не использовать `--no-bundle`: он пропускает custom build. В Cloudflare сохранённая Build command может выполнять предварительную сборку; повторная сборка внутри deploy намеренна и обеспечивает одинаковую проверку локального и автоматического выпуска.

Проверка без публикации: `npx wrangler@4.134.0 deploy --dry-run` для production и `npx wrangler@4.134.0 deploy --env staging --dry-run` для stage. Эти команды не меняют опубликованную версию и DNS. Откат выполняется отдельно для нужного Worker на проверенный Version ID; он не меняет приложение или БД. После отката повторить проверку HTTPS, адресов приложения и демо.

Stage использует Custom Domain `stage-www.qvesta.ru`, привязка объявлена в `env.staging.routes`. Production-домен `qvesta.ru` ещё не подключён. Проекты приложения и их команды сборки сохраняются. Пакет Sites оставлен для совместимости, Cloudflare использует только `dist/client`. Техническое имя npm-пакета пока сохранено. Vite обновлён до 6.4.3, транзитивные зависимости — совместимыми версиями для устранения найденных npm audit уязвимостей.

## Независимые проверки и публикация
`Website CI` проверяет обе сборки при изменении `website/**` или своего workflow, без Supabase и секретов приложения. Проверка `npm run test:build -- staging` (или `production`) проверяет адрес приложения в фактически собранном JavaScript. Выполнять после соответствующей сборки. CI не публикует сайт.

Для Workers Builds: root directory `website`, отдельные Workers для веток `main` и `staging`, команды из раздела Cloudflare. Watch paths сайта: include `website/*`. Перед первым объединением изменений сайта проверить watch paths существующих Workers приложения: исключить `website/*` только после сверки действующих настроек. GitHub CI приложения пока сохранён без изменений. Это не гарантирует пропуск сборок приложения, пока фильтры Cloudflare не настроены.

Описание монорепозитория: https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/ ; фильтры: https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/ .

## Ограничения
Сайт опубликован на stage: https://stage-www.qvesta.ru/ . Production сайта ещё не выпущен. Исходные визуальные и интерактивные проверки — см. design-qa.md и qa/verification.json. Реальные мобильные устройства и production-вход не проверялись. Сбор контактов, backend для заявок, AI, платежи и коммерческие тарифы не подключены. Шрифты Manrope/Caveat загружаются с Google Fonts; перед production желательно локальное размещение. Stage отдаёт X-Robots-Tag: noindex, nofollow; это запрет индексации, а не ограничение доступа.

## Основные файлы
- `src/App.jsx`: композиция и локальные взаимодействия.
- `src/landing.css`: адаптивные стили.
- `src/main.jsx`, `index.html`: подключение стилей, язык и метаданные.
- `public/assets/hero-library.png`, `quest-phone.png`: изображения, созданные встроенным ImageGen.
- `public/assets/logo.png`: существующий знак проекта.
- `public/assets/icons`: Tabler outline icons, MIT; лицензия рядом.

## ImageGen assets
Reference: first displayed result `exec-c1d1b164-4204-479c-bb6e-a5b35b4b315e.png`.
- Hero prompt brief: warm candid library photograph of an educator and three children aged 9–12 solving clues, same composition and palette as selected mock; no UI or phone overlay; portrait asset.
- Phone prompt brief: isolated slightly tilted black smartphone with Russian quest interface, architecture photo and answer field; preserve device/UI and extract background to real alpha.
Tool: built-in image_gen. Originals preserved; consuming copies are in public/assets. Generation staging copies: ../landing-prototype-assets.


## Обновление 16 сентября
Демо расширено до трёх заданий с итогом и повторным прохождением. Аудитория переименована в «Мероприятия и праздники». Шаг 2 объясняет состав задания и открывает пример; это не редактор на лендинге. Изменены src/App.jsx, src/QuestDemo.jsx, src/refinements.css, scripts/verify-landing.mjs; обновлены QA-снимки и документация.


## Публичный каталог тарифов
Для публикации обязательны переменные сборки VITE_PUBLIC_SUPABASE_URL и VITE_PUBLIC_SUPABASE_ANON_KEY (только anon/publishable). Для stage — проект jeugfyaqzfgdvfhdxfht. Значения задаются в среде запуска или Workers Builds, не в репозитории. check-catalog-env.mjs останавливает публикацию без настроек или при смешении сред. Обычные CI-сборки без настроек проверяют интерфейс; они не публикуются.

Перед сайтом применить миграцию 20260926038000 через public-tariffs-dry-run/apply. Сайт загружает цены и лимиты текущих версий по серверному времени при открытии. Черновики/будущие/отозванные версии не публикуются. При недоступности каталога статические цены не показываются.
