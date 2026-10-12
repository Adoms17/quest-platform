import { useState } from 'react'
import { validPublicCover } from './publicExtrasContract'

function Image({ record }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Fallback />
  return <figure className="candidate-cover"><img src={record.path} alt={record.alt} width={record.width} height={record.height}
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    {record.review.attribution && <figcaption>{record.review.attribution}</figcaption>}</figure>
}
function Fallback() { return <div className="candidate-cover candidate-cover-fallback">Обложка не опубликована</div> }
export default function PublicCoverCandidate({ record, context }) {
  return validPublicCover(record, context) ? <Image key={JSON.stringify(record)} record={record} /> : <Fallback />
}
