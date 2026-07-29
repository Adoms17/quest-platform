import { ClipLoader, PulseLoader, RingLoader, ScaleLoader } from 'react-spinners'

export default function Loader({ 
  type = 'clip', 
  size = 50, 
  color = '#3b82f6',
  text = 'Загрузка...'
}) {
  const types = {
    clip: ClipLoader,
    pulse: PulseLoader,
    ring: RingLoader,
    scale: ScaleLoader,
  }
  
  const Spinner = types[type] || ClipLoader

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <Spinner size={size} color={color} />
      {text && <p className="mt-4 text-gray-600">{text}</p>}
    </div>
  )
}