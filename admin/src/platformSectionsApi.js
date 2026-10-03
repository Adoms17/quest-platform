export const platformSections = [
 ['organizations', 'Организации'], ['tariffs', 'Тарифы'], ['campaigns', 'Акции'],
 ['statistics', 'Статистика платформы'], ['documents', 'Документы'],
 ['fiscal-acceptance', 'Тестовый заказ'], ['fiscal-policy', 'Тестовые чеки'],
]
export async function readPlatformSections(client) {
 const {data,error}=await client.rpc('read_my_platform_sections')
 if(error) throw Error('access_check_failed')
 if(!Array.isArray(data)||data.some(key=>typeof key!=='string'||!platformSections.some(([id])=>id===key))) throw Error('invalid_sections')
 return platformSections.filter(([id])=>data.includes(id))
}
