// Fail closed before test imports, in the runner and inherited workers.
const deny = () => { throw new Error('OFFLINE_TEST_NETWORK_FORBIDDEN') }
for (const name of ['node:http', 'node:https']) {
  const mod = require(name)
  mod.request = deny
  mod.get = deny
}
const net = require('node:net')
net.connect = deny
net.createConnection = deny
require('node:tls').connect = deny
globalThis.fetch = deny
require('node:module').syncBuiltinESMExports()
