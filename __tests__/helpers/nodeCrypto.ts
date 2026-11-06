/**
 * A real AES-256-GCM implementation of the jarvis-crypto module for tests, on Node's crypto, so
 * sealing, opening and AAD binding are exercised for real instead of returning mock strings.
 * Use: jest.mock('jarvis-crypto', () => require('../helpers/nodeCrypto'));
 */
import * as nodeCrypto from 'crypto';

const b64 = (b: Buffer): string => b.toString('base64url');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64url');

export const randomBytes = jest.fn(async (n: number) => b64(nodeCrypto.randomBytes(n)));

export const aesGcmEncrypt = jest.fn(async (key: string, iv: string, plaintext: string, aad: string) => {
  const c = nodeCrypto.createCipheriv('aes-256-gcm', unb64(key), unb64(iv));
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(unb64(plaintext)), c.final()]);
  return { ciphertext: b64(ct), tag: b64(c.getAuthTag()) };
});

export const aesGcmDecrypt = jest.fn(
  async (key: string, iv: string, ciphertext: string, tag: string, aad: string) => {
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', unb64(key), unb64(iv));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(unb64(tag));
    return b64(Buffer.concat([d.update(unb64(ciphertext)), d.final()]));
  },
);

export const argon2id = jest.fn();
