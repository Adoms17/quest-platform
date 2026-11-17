const rules = new Intl.PluralRules('ru')
const forms = { one: 'квест', few: 'квеста', many: 'квестов', other: 'квеста' }
export function questCount(count) { return `${count} ${forms[rules.select(count)]}` }
