import base from './vite.config.mjs'
import { validateStageEnvironment, stage } from './stage-contract.mjs'
export default context => {
  if (context.command !== 'build' || context.mode !== 'staging') throw Error('Stage build only')
  validateStageEnvironment(process.env)
  const config = base(context)
  return { ...config, plugins: [...config.plugins, { name: 'market-stage-policy', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'stage-policy.json', source: JSON.stringify({ schema: 1, origin: stage.origin, appOrigin: stage.appOrigin, backend: stage.backend, sales: false }) })
  } }], envPrefix: [], define: {
    ...config.define,
    'import.meta.env.VITE_APP_ORIGIN': JSON.stringify(stage.appOrigin),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(stage.backend),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY),
    'import.meta.env.VITE_MARKET_SALES_ENABLED': JSON.stringify('false'),
  } }
}
