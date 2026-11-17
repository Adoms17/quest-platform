import { resolve } from 'node:path'
export default { root: resolve('.'), envDir: false, cacheDir: resolve('node_modules/.vite-shop-play-review'), test: { environment: 'node', maxWorkers: 1, include: ['scripts/shop-fixture-loader.test.js', 'scripts/shop-play-offline-isolated.test.js'] } }
