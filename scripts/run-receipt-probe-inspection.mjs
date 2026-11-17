import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectReceiptProbe } from './inspect-receipt-probe.mjs'
try {
  if (process.env.GITHUB_REPOSITORY !== 'Adoms17/quest-platform' || process.env.GITHUB_REF !== 'refs/heads/staging'
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !process.env.RUNNER_TEMP) throw new Error()
  const result = await inspectReceiptProbe({shopId:process.env.YOOKASSA_SANDBOX_SHOP_ID,secretKey:process.env.YOOKASSA_SANDBOX_SECRET_KEY})
  await writeFile(join(process.env.RUNNER_TEMP,'receipt-probe-inspection.json'),JSON.stringify(result),{flag:'wx',mode:0o600})
  console.log(JSON.stringify(result))
} catch {
  console.error('Receipt probe inspection failed; no payment or refund was sent.')
  process.exitCode=1
}
