import {
  RecoveryCodeError,
  crc32,
  decodeRecoveryCode,
  encodeRecoveryCode,
  normaliseRecoveryCode,
} from '../../src/services/recoveryCodeService';

// 32 bytes 0x00..0x1f
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('recoveryCodeService', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('encodes to twelve groups of five Crockford characters', () => {
    const code = encodeRecoveryCode(KEY);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){11}[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('round trips any 32-byte key', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
      let bin = '';
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      const key = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(decodeRecoveryCode(encodeRecoveryCode(key))).toBe(key);
    }
  });

  it('matches a golden produced by an independent implementation (Python zlib.crc32)', () => {
    // 0x01 | bytes 0..31 | CRC-32 of those 33 bytes, Crockford base32, 4 zero padding bits.
    const golden = '04002-0G30G-2GC1R-81450-P30D1-R7H04-8J2CA-1A5GQ-30CHM-6RW3M-F1ZH5-2G5CG';
    expect(encodeRecoveryCode(KEY)).toBe(golden);
    expect(decodeRecoveryCode(golden)).toBe(KEY);
  });

  it('accepts lower case, spaces, missing dashes and look-alike characters', () => {
    const code = encodeRecoveryCode(KEY);
    expect(decodeRecoveryCode(code.toLowerCase())).toBe(KEY);
    expect(decodeRecoveryCode(code.replace(/-/g, ' '))).toBe(KEY);
    expect(decodeRecoveryCode(code.replace(/-/g, ''))).toBe(KEY);
    expect(normaliseRecoveryCode('o1Il')).toBe('0111');
    expect(decodeRecoveryCode(code.replace(/0/g, 'O').replace(/1/g, 'l'))).toBe(KEY);
  });

  it('rejects a wrong length', () => {
    expect(() => decodeRecoveryCode('ABCDE-FGHJK')).toThrow(RecoveryCodeError);
    try {
      decodeRecoveryCode('ABCDE');
    } catch (e) {
      expect((e as RecoveryCodeError).kind).toBe('length');
    }
  });

  it('rejects characters outside the alphabet', () => {
    const code = encodeRecoveryCode(KEY).replace(/^./, 'U');
    expect(() => decodeRecoveryCode(code)).toThrow(/not used/);
  });

  it('catches every single-character typo', () => {
    const code = encodeRecoveryCode(KEY).replace(/-/g, '');
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < code.length; i++) {
      const other = alphabet[(alphabet.indexOf(code[i]) + 1) % 32];
      const typo = code.slice(0, i) + other + code.slice(i + 1);
      let decoded: string | null = null;
      try {
        decoded = decodeRecoveryCode(typo);
      } catch (e) {
        expect(e).toBeInstanceOf(RecoveryCodeError);
      }
      expect(decoded).toBeNull();
    }
  });

  it('rejects a code with a future version', () => {
    // Flip the version byte (the first 8 bits) and fix nothing else: version is checked before the CRC.
    const code = encodeRecoveryCode(KEY).replace(/-/g, '');
    const bad = '1' + code.slice(1);
    expect(() => decodeRecoveryCode(bad)).toThrow(RecoveryCodeError);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => encodeRecoveryCode('AAAA')).toThrow(/32 bytes/);
  });
});
