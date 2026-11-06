import * as nodeCrypto from 'crypto';

import { FleetConfigItem } from '../../src/api/fleetConfigApi';
import {
  FLEET_TYPES,
  readFleetConfig,
  rotateHouseholdKey,
  setFleetValues,
} from '../../src/services/fleetConfigService';
import {
  WrongRecoveryCodeError,
  adoptNode,
  createHouseholdKey,
  fleetAad,
  getHouseholdKey,
  getPreviousHouseholdKey,
  recoveryCodeFor,
  restoreFromRecoveryCode,
  verifyAgainstFleet,
} from '../../src/services/householdKeyService';
import { RecoveryCodeError, decodeRecoveryCode } from '../../src/services/recoveryCodeService';
import { aesGcmDecrypt, aesGcmEncrypt } from 'jarvis-crypto';

jest.mock('jarvis-crypto', () => require('../helpers/nodeCrypto'));

// SecureStore in memory.
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

// jarvisd's fleet routes in memory: ciphertext only.
const mockServer = new Map<string, FleetConfigItem>();
let mockRevision = 0;
jest.mock('../../src/api/fleetConfigApi', () => ({
  listFleetConfig: jest.fn(async () => [...mockServer.values()]),
  putFleetConfig: jest.fn(async (hh: string, type: string, sealed: any) => {
    mockServer.set(type, { household_id: hh, config_type: type, ...sealed, revision: ++mockRevision });
    return { config_type: type, revision: mockRevision, nodes_notified: 2 };
  }),
  deleteFleetConfig: jest.fn(async (_hh: string, type: string) => void mockServer.delete(type)),
}));

const mockProvision = jest.fn();
jest.mock('../../src/api/nodeSettingsApi', () => ({
  provisionK2ToNode: (...a: unknown[]) => mockProvision(...a),
}));

const HH = 'hh1';

beforeEach(() => {
  mockStore.clear();
  mockServer.clear();
  mockRevision = 0;
  mockProvision.mockReset().mockResolvedValue(undefined);
});

describe('household key and recovery code', () => {
  it('creates one key per household and refuses to replace it', async () => {
    const kh = await createHouseholdKey(HH);
    expect(Buffer.from(kh.k2, 'base64url')).toHaveLength(32);
    await expect(createHouseholdKey(HH)).rejects.toThrow(/already has a key/);
    expect((await getHouseholdKey(HH))!.k2).toBe(kh.k2);
  });

  it('the recovery code decodes back to the key', async () => {
    const kh = await createHouseholdKey(HH);
    expect(decodeRecoveryCode(recoveryCodeFor(kh))).toBe(kh.k2);
  });

  it('restores on a new phone: the right code is proven against what the server holds', async () => {
    const kh = await createHouseholdKey(HH);
    await setFleetValues(HH, FLEET_TYPES.secrets, { WEATHER_API_KEY: 'abc' });
    const code = recoveryCodeFor(kh);

    mockStore.clear(); // a new phone
    expect(await getHouseholdKey(HH)).toBeNull();
    const { pair, check } = await restoreFromRecoveryCode(HH, code, [...mockServer.values()]);
    expect(check).toBe('verified');
    expect(pair.k2).toBe(kh.k2);
    expect(await readFleetConfig(HH, FLEET_TYPES.secrets)).toEqual({ WEATHER_API_KEY: 'abc' });
  });

  it('a well formed but wrong code never replaces the stored key', async () => {
    const kh = await createHouseholdKey(HH);
    await setFleetValues(HH, FLEET_TYPES.secrets, { A: '1' });
    const other = nodeCrypto.randomBytes(32).toString('base64url');
    const { encodeRecoveryCode } = require('../../src/services/recoveryCodeService');
    await expect(
      restoreFromRecoveryCode(HH, encodeRecoveryCode(other), [...mockServer.values()]),
    ).rejects.toBeInstanceOf(WrongRecoveryCodeError);
    expect((await getHouseholdKey(HH))!.k2).toBe(kh.k2);
  });

  it('a typo is a RecoveryCodeError before anything is checked or stored', async () => {
    mockStore.clear();
    await expect(restoreFromRecoveryCode(HH, 'ABCDE-FGHJK', [])).rejects.toBeInstanceOf(RecoveryCodeError);
    expect(mockStore.size).toBe(0);
  });

  it('with nothing stored on the server the code is accepted but reported unverifiable', async () => {
    const kh = await createHouseholdKey(HH);
    const code = recoveryCodeFor(kh);
    mockStore.clear();
    const { check } = await restoreFromRecoveryCode(HH, code, []);
    expect(check).toBe('unverifiable');
    expect(await verifyAgainstFleet(HH, kh.k2, [])).toBe('unverifiable');
  });
});

describe('fleet config sealing', () => {
  it('seals with the household AAD, which a node AAD cannot open', async () => {
    const kh = await createHouseholdKey(HH);
    const notified = await setFleetValues(HH, FLEET_TYPES.secrets, { WEATHER_API_KEY: 'abc' });
    expect(notified).toBe(2);
    const item = mockServer.get('secrets')!;
    const open = (aad: string) => aesGcmDecrypt(kh.k2, item.nonce, item.ciphertext, item.tag, aad);
    expect(JSON.parse(Buffer.from(await open(fleetAad(HH, 'secrets')), 'base64url').toString())).toEqual({
      WEATHER_API_KEY: 'abc',
    });
    await expect(open('n1:secrets')).rejects.toThrow();
    await expect(open(fleetAad('hh2', 'secrets'))).rejects.toThrow();
    // The server never sees the plaintext.
    expect(JSON.stringify(item)).not.toContain('abc');
  });

  it('matches the Go node byte for byte (vector pinned in fleet_test.go)', async () => {
    const { ciphertext, tag } = await aesGcmEncrypt(
      'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
      'YWJjZGVmZ2hpamts',
      Buffer.from('{"WEATHER_API_KEY":"abc"}').toString('base64url'),
      fleetAad('hh1', 'secrets'),
    );
    expect(ciphertext).toBe('Eu6e-oqxJZYxQ7NBQ8YTegUTgT3Y4gx5Yw');
    expect(tag).toBe('GA7I3CryDzXorVsoTisqEg');
  });

  it('merges a patch into what is stored and removes keys set to null', async () => {
    await createHouseholdKey(HH);
    await setFleetValues(HH, FLEET_TYPES.secrets, { A: '1', B: '2' });
    await setFleetValues(HH, FLEET_TYPES.secrets, { B: '3', C: '4', A: null });
    expect(await readFleetConfig(HH, FLEET_TYPES.secrets)).toEqual({ B: '3', C: '4' });
  });

  it('keeps JSON types (a boolean stays a boolean, a number a number)', async () => {
    await createHouseholdKey(HH);
    await setFleetValues(HH, FLEET_TYPES.nodeSettings, { volume_percent: 40, is_muted: false });
    expect(await readFleetConfig(HH, FLEET_TYPES.nodeSettings)).toEqual({ volume_percent: 40, is_muted: false });
  });

  it('needs a key on this phone', async () => {
    await expect(setFleetValues(HH, FLEET_TYPES.secrets, { A: '1' })).rejects.toThrow(/no key on this phone/);
  });
});

describe('adopting nodes and rotation', () => {
  it('adoptNode gives a node the household key through the K2 relay', async () => {
    const kh = await createHouseholdKey(HH);
    await adoptNode(HH, 'n1');
    expect(mockProvision).toHaveBeenCalledWith('n1', kh.k2, kh.kid, kh.createdAt);
  });

  it('rotation reseals every item under a new key, adopts every node, and drops the old key', async () => {
    const old = await createHouseholdKey(HH);
    await setFleetValues(HH, FLEET_TYPES.secrets, { A: '1' });
    await setFleetValues(HH, FLEET_TYPES.nodeSettings, { volume_percent: 30 });

    const res = await rotateHouseholdKey(HH, ['n1', 'n2']);
    expect(res).toEqual({ resealed: 2, adopted: ['n1', 'n2'] });

    const next = (await getHouseholdKey(HH))!;
    expect(next.k2).not.toBe(old.k2);
    expect(await getPreviousHouseholdKey(HH)).toBeNull();
    expect(await readFleetConfig(HH, FLEET_TYPES.secrets)).toEqual({ A: '1' });
    expect(await readFleetConfig(HH, FLEET_TYPES.nodeSettings)).toEqual({ volume_percent: 30 });
    for (const item of mockServer.values()) {
      expect(await verifyAgainstFleet(HH, old.k2, [item])).toBe('wrong'); // the leaked code is dead
      expect(await verifyAgainstFleet(HH, next.k2, [item])).toBe('verified');
    }
    expect(mockProvision.mock.calls.map((c) => c[0])).toEqual(['n1', 'n2']);
    expect(mockProvision.mock.calls[0][1]).toBe(next.k2);
  });

  it('a rotation that stops half way can be run again with the same new key', async () => {
    const old = await createHouseholdKey(HH);
    await setFleetValues(HH, FLEET_TYPES.secrets, { A: '1' });
    mockProvision.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('504 node offline'));

    await expect(rotateHouseholdKey(HH, ['n1', 'n2'])).rejects.toThrow(/504/);
    const half = (await getHouseholdKey(HH))!;
    expect(half.k2).not.toBe(old.k2);
    expect((await getPreviousHouseholdKey(HH))!.k2).toBe(old.k2);

    const res = await rotateHouseholdKey(HH, ['n1', 'n2']);
    expect(res.adopted).toEqual(['n1', 'n2']);
    expect((await getHouseholdKey(HH))!.k2).toBe(half.k2);
    expect(await getPreviousHouseholdKey(HH)).toBeNull();
    expect(await readFleetConfig(HH, FLEET_TYPES.secrets)).toEqual({ A: '1' });
  });

  it('opens nothing and changes nothing when an item cannot be opened', async () => {
    const kh = await createHouseholdKey(HH);
    mockServer.set('secrets', {
      household_id: HH, config_type: 'secrets', ciphertext: 'AAAA', nonce: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA', revision: 1,
    });
    await expect(rotateHouseholdKey(HH, ['n1'])).rejects.toThrow(/nothing was changed/);
    expect((await getHouseholdKey(HH))!.k2).toBe(kh.k2);
    expect(mockProvision).not.toHaveBeenCalled();
  });
});
