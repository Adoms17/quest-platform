import { useEffect } from 'react'
import { startAccountActivity } from '../services/accountActivity'

export function useAccountActivity(userId) {
  useEffect(() => {
    if (!userId) return
    return startAccountActivity()
  }, [userId])
}
