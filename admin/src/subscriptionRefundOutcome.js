export function subscriptionRefundOutcome(result) {
 if (!result) return null
 if (result.accessEffect === 'applied_review_required') return { terminal: true, text: 'Период прекращён, но результат возврата требует проверки.' }
 if (result.accessEffect === 'review_required' || result.state === 'review') return { terminal: true, text: 'Требуется проверка результата возврата и доступа.' }
 if (result.state === 'succeeded' && result.accessEffect === 'applied') return { terminal: true, text: 'Возврат выполнен, возвращаемый период прекращён.' }
 if (result.state === 'succeeded') return { terminal: false, text: 'Деньги возвращены. Прекращение периода ещё не подтверждено. Повторите проверку с новым кодом MFA.' }
 if (['canceled','rejected'].includes(result.state)) return { terminal: true, text: 'Возврат не выполнен. Подписка сохранена.' }
 return { terminal: false, text: 'Операция обрабатывается. Повторите проверку с новым кодом MFA.' }
}
