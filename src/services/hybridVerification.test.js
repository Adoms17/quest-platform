import { describe, expect, it, vi } from 'vitest'
import {
  createHybridVerifier,
  HYBRID_PBKDF2_ITERATIONS,
  normalizeHybridValue,
  verifyHybridCandidate,
} from './hybridVerification'

function createFakeCrypto() {
  let saltSeed = 0
  const deriveBits = vi.fn(async (algorithm, key, length) => {
    const digest = new Uint8Array(length / 8)
    const input = [...key.bytes, ...new Uint8Array(algorithm.salt)]
    const seed = input.reduce((sum, byte) => (sum + byte) % 256, 0)
    digest.fill(seed)
    return digest.buffer
  })

  return {
    getRandomValues(bytes) {
      saltSeed += 1
      bytes.fill(saltSeed)
      return bytes
    },
    subtle: {
      importKey: vi.fn(async (_format, bytes) => ({
        bytes: [...new Uint8Array(bytes)],
      })),
      deriveBits,
    },
  }
}

describe('hybrid verification', () => {
  it('normalizes case and whitespace while binding the purpose', () => {
    expect(normalizeHybridValue('  SeCrEt  ', 'code')).toBe(
      'quest-platform:code:v1:secret'
    )
    expect(normalizeHybridValue('  SeCrEt  ', 'answer')).toBe(
      'quest-platform:answer:v1:secret'
    )
  })

  it('creates a versioned PBKDF2-HMAC-SHA-256 verifier', async () => {
    const cryptoProvider = createFakeCrypto()
    const verifier = await createHybridVerifier('CODE', 'code', cryptoProvider)

    expect(verifier).toMatchObject({
      version: 1,
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iterations: HYBRID_PBKDF2_ITERATIONS,
      normalization: 'trim-lowercase-v1',
      purpose: 'code',
    })
    expect(JSON.stringify(verifier)).not.toContain('CODE')
    expect(cryptoProvider.subtle.deriveBits).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: 600_000,
      }),
      expect.anything(),
      256
    )
  })

  it('accepts an equivalent candidate and rejects a different one', async () => {
    const cryptoProvider = createFakeCrypto()
    const verifier = await createHybridVerifier('Answer', 'answer', cryptoProvider)

    await expect(
      verifyHybridCandidate('  ANSWER ', verifier, cryptoProvider)
    ).resolves.toBe(true)
    await expect(
      verifyHybridCandidate('wrong', verifier, cryptoProvider)
    ).resolves.toBe(false)
  })

  it('rejects downgraded or tampered verifier parameters', async () => {
    const cryptoProvider = createFakeCrypto()
    const verifier = await createHybridVerifier('CODE', 'code', cryptoProvider)

    await expect(verifyHybridCandidate('CODE', {
      ...verifier,
      iterations: 1,
    }, cryptoProvider)).rejects.toThrow('Неподдерживаемый формат')
  })
})
