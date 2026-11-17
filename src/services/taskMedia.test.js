import { expect, it } from 'vitest'
import { getTaskMediaKind } from './taskMedia'
it('recognizes immutable inline shop audio and video without filename extensions', () => {
  expect(getTaskMediaKind('data:audio/wav;base64,AAAA')).toBe('audio')
  expect(getTaskMediaKind('data:video/webm;base64,AAAA')).toBe('video')
  expect(getTaskMediaKind('data:image/png;base64,AAAA')).toBe('image')
})
