export function subscriptionRefundOutcome(result) {
 if (!result) return null
 if (result.commandId) {
  const money = ({succeeded:'Деньги возвращены.',canceled:'Возврат отменён.',rejected:'Возврат отклонён.',review:'Денежный результат требует проверки.'})[result.state] || 'Денежный результат пока не подтверждён.'
  const receipt = ({succeeded:'Чек возврата подтверждён.',pending:'Чек возврата обрабатывается.',canceled:'Чек возврата не сформирован; требуется проверка.',unknown:'Ожидается подтверждение чека возврата.'})[result.receiptStatus] || 'Подтверждения чека возврата пока нет.'
  const access = ({applied:'Возвращаемый период прекращён.',applied_review_required:'Период прекращён; результат требует проверки.',review_required:'Изменение доступа требует проверки.',not_applied:'Возвращаемый период пока не прекращён.'})[result.accessEffect] || 'Состояние доступа не подтверждено.'
  const review = result.requiresReview || ['review_required','applied_review_required'].includes(result.accessEffect)
  return { terminal: !!review || ['canceled','rejected'].includes(result.state) || (result.state==='succeeded'&&result.receiptStatus==='succeeded'&&result.accessEffect==='applied'),
   text: money, details: [receipt,access,...(review?['Требуется ручная сверка; повторная отправка недоступна.']:[])] }
 }
 if (result.accessEffect === 'applied_review_required') return { terminal: true, text: 'Период прекращён, но результат возврата требует проверки.' }
 if (result.accessEffect === 'review_required' || result.state === 'review') return { terminal: true, text: 'Требуется проверка результата возврата и доступа.' }
 if (result.state === 'succeeded' && result.accessEffect === 'applied') return { terminal: true, text: 'Возврат выполнен, возвращаемый период прекращён.' }
 if (result.state === 'succeeded') return { terminal: false, text: 'Деньги возвращены. Прекращение периода ещё не подтверждено. Повторите проверку с новым кодом MFA.' }
 if (['canceled','rejected'].includes(result.state)) return { terminal: true, text: 'Возврат не выполнен. Подписка сохранена.' }
 return { terminal: false, text: 'Операция обрабатывается. Повторите проверку с новым кодом MFA.' }
}
