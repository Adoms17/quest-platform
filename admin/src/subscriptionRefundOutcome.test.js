import { expect, test } from 'vitest'
import { subscriptionRefundOutcome } from './subscriptionRefundOutcome'
test('money success without access confirmation remains recoverable',()=>{
 expect(subscriptionRefundOutcome({state:'succeeded',accessEffect:'not_applied'})).toMatchObject({terminal:false})
 expect(subscriptionRefundOutcome({state:'succeeded',accessEffect:'applied'})).toMatchObject({terminal:true})
 expect(subscriptionRefundOutcome({state:'review',accessEffect:'applied_review_required'}).text).toContain('Период прекращён')
 expect(subscriptionRefundOutcome({state:'succeeded',accessEffect:'review_required'}).text).not.toContain('Период прекращён')
})
