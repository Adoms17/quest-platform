// Both server timestamps and locally captured load times use the device zone.
export default function DeviceDateTime({ value }) {
 const date = typeof value === 'string' && value.trim() ? new Date(value) : null
 if (!date || !Number.isFinite(date.getTime())) return 'Неизвестно'
 return <time dateTime={date.toISOString()}>{date.toLocaleString('ru-RU')}</time>
}
