import base from './public-design.playwright.config.mjs'

// Run the same public UI suite against an already-built synthetic local artifact.
// No dev transforms, remote backend, credentials or deploy operation are involved.
process.env.MARKET_PUBLIC_BUILT_TEST = '1'
export default {
  ...base,
  outputDir: './qa/filter-availability/browser-results',
  webServer: { ...base.webServer, command: base.webServer.command.replace(' --host', ' preview --host') },
}
