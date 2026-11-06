/**
 * Household recovery code (docs/cc/14-fleet-config-and-recovery.md in jarvis-server).
 *
 * The code IS the household key (KH), written so a person can keep it in a password vault and
 * type it back on a new phone: 60 characters of Crockford base32 in twelve groups of five.
 *
 *   payload = 0x01 (version) | KH (32 bytes) | CRC-32 of the first 33 bytes (big endian)
 *
 * The CRC only catches typos. Whether a code is the RIGHT key is decided by opening something
 * sealed with the key (householdKeyService.verifyAgainstFleet), never by this check.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VERSION = 0x01;
const KEY_BYTES = 32;
const PAYLOAD_BYTES = 1 + KEY_BYTES + 4;
const CODE_CHARS = 60; // ceil(37 * 8 / 5); the last 4 bits are zero padding
const GROUP = 5;

export type RecoveryCodeErrorKind = 'length' | 'characters' | 'version' | 'checksum';

export class RecoveryCodeError extends Error {
  readonly kind: RecoveryCodeErrorKind;

  constructor(kind: RecoveryCodeErrorKind, message: string) {
    super(message);
    this.name = 'RecoveryCodeError';
    this.kind = kind;
  }
}

const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** Encode a base64url household key (32 bytes) as a grouped recovery code. */
export const encodeRecoveryCode = (keyB64url: string): string => {
  const key = b64urlToBytes(keyB64url);
  if (key.length !== KEY_BYTES) {
    throw new Error(`Household key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload[0] = VERSION;
  payload.set(key, 1);
  const crc = crc32(payload.subarray(0, 1 + KEY_BYTES));
  new DataView(payload.buffer).setUint32(1 + KEY_BYTES, crc, false);

  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of payload) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out.match(new RegExp(`.{1,${GROUP}}`, 'g'))!.join('-');
};

/** Crockford normalisation: case, separators, and the look-alikes O -> 0 and I/L -> 1. */
export const normaliseRecoveryCode = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

/** Decode a typed or pasted recovery code to the base64url household key. */
export const decodeRecoveryCode = (text: string): string => {
  const code = normaliseRecoveryCode(text);
  if (code.length !== CODE_CHARS) {
    throw new RecoveryCodeError(
      'length',
      `A recovery code has ${CODE_CHARS} characters; this one has ${code.length}.`,
    );
  }
  const values: number[] = [];
  for (const ch of code) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new RecoveryCodeError('characters', `"${ch}" is not used in recovery codes.`);
    values.push(v);
  }
  const payload = new Uint8Array(PAYLOAD_BYTES);
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (n < PAYLOAD_BYTES) payload[n++] = (acc >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  // The four padding bits left over must be zero in a code this app produced.
  if (acc !== 0) throw new RecoveryCodeError('checksum', 'The last character is not valid.');
  if (payload[0] !== VERSION) {
    throw new RecoveryCodeError('version', 'This recovery code is from a newer version of the app.');
  }
  const want = new DataView(payload.buffer).getUint32(1 + KEY_BYTES, false);
  if (crc32(payload.subarray(0, 1 + KEY_BYTES)) !== want) {
    throw new RecoveryCodeError('checksum', 'The code has a typo: the check digits do not match.');
  }
  return bytesToB64url(payload.subarray(1, 1 + KEY_BYTES));
};
