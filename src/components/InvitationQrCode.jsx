import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

export default function InvitationQrCode({ value, label = 'приглашения' }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!open || !canvasRef.current || !value) return
    let active = true
    setError('')
    QRCode.toCanvas(canvasRef.current, value, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
    }).catch(() => {
      if (active) setError('Не удалось сформировать QR-код.')
    })
    return () => { active = false }
  }, [open, value])

  if (!value) return null

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="text-sm text-blue-700 hover:underline"
    >
      Показать QR
    </button>
    {open && <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invitation-qr-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-5 text-center shadow-xl">
        <h2 id="invitation-qr-title" className="text-xl font-semibold">
          QR-код {label}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Отсканируйте камерой телефона. QR содержит ту же ссылку, что и кнопка копирования.
        </p>
        <div className="mt-4 flex min-h-60 items-center justify-center">
          <canvas ref={canvasRef} aria-label={`QR-код ${label}`} />
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 w-full rounded-lg border border-blue-600 px-4 py-2 text-blue-700"
        >
          Закрыть
        </button>
      </div>
    </div>}
  </>
}
