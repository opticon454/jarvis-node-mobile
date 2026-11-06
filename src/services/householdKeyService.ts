/**
 * The household key (KH): one 32-byte key shared by every node of a household, held on the
 * phone and on the nodes, never on the server (docs/cc/14-fleet-config-and-recovery.md).
 *
 * It lives in the same SecureStore slots as a node's K2, under the pseudo node id
 * `household-{id}`, so it is user-scoped, survives logout and is deliberately not deleted by
 * clearUserData. A node stores it in its normal K2 slot, so the existing K2 relay delivers it.
 */

import { aesGcmDecrypt } from 'jarvis-crypto';

import { decodeRecoveryCode, encodeRecoveryCode } from './recoveryCodeService';
import { K2KeyPair, deleteK2, generateK2, getK2, storeK2 } from './k2Service';
import { provisionK2ToNode } from '../api/nodeSettingsApi';
import type { FleetConfigItem } from '../api/fleetConfigApi';

// These become SecureStore keys (see k2Service), which accept only letters, digits, ".", "-" and "_":
// a colon is rejected on a real device although the Jest mock accepts anything.
export const householdKeyId = (householdId: string): string => `household-${householdId}`;
export const previousKeyId = (householdId: string): string => `household-previous-${householdId}`;

/** AAD for fleet config: bound to the household and type, not to a node (see FleetAAD in Go). */
export const fleetAad = (householdId: string, configType: string): string =>
  `${householdId}:fleet:${configType}`;

export const getHouseholdKey = (householdId: string): Promise<K2KeyPair | null> =>
  getK2(householdKeyId(householdId));

/** The key being rotated away from, kept only until a rotation finishes. */
export const getPreviousHouseholdKey = (householdId: string): Promise<K2KeyPair | null> =>
  getK2(previousKeyId(householdId));

export const clearPreviousHouseholdKey = (householdId: string): Promise<void> =>
  deleteK2(previousKeyId(householdId));

/** Create the household key. Refuses to replace one: rotate or restore on purpose instead. */
export async function createHouseholdKey(householdId: string): Promise<K2KeyPair> {
  if (await getHouseholdKey(householdId)) {
    throw new Error('This household already has a key. Rotate it or restore it from the recovery code.');
  }
  const pair = await generateK2(householdKeyId(householdId));
  await storeK2(pair);
  return pair;
}

export const recoveryCodeFor = (pair: K2KeyPair): string => encodeRecoveryCode(pair.k2);

/** Open one stored item with a key; false when the key is not the one that sealed it. */
export async function canOpen(householdId: string, keyB64url: string, item: FleetConfigItem): Promise<boolean> {
  try {
    await aesGcmDecrypt(
      keyB64url,
      item.nonce,
      item.ciphertext,
      item.tag,
      fleetAad(householdId, item.config_type),
    );
    return true;
  } catch {
    return false;
  }
}

export type KeyCheck = 'verified' | 'wrong' | 'unverifiable';

/**
 * Whether a key is this household's key. Opening something the server holds is the only real
 * proof; with nothing stored there is nothing to open, so the answer is 'unverifiable' and the
 * caller must say so rather than claim the code is right.
 */
export async function verifyAgainstFleet(
  householdId: string,
  keyB64url: string,
  items: FleetConfigItem[],
): Promise<KeyCheck> {
  if (items.length === 0) return 'unverifiable';
  for (const item of items) {
    if (await canOpen(householdId, keyB64url, item)) return 'verified';
  }
  return 'wrong';
}

export class WrongRecoveryCodeError extends Error {
  constructor() {
    super('That code is well formed but it is not this household\'s key. Nothing was changed.');
    this.name = 'WrongRecoveryCodeError';
  }
}

/**
 * Restore the household key on this phone from a recovery code. A malformed code throws
 * RecoveryCodeError and a code that cannot open the household's stored config throws
 * WrongRecoveryCodeError, both before anything is written, so a bad entry never replaces a key.
 * Returns whether the key was proven ('verified') or accepted unproven ('unverifiable').
 */
export async function restoreFromRecoveryCode(
  householdId: string,
  code: string,
  items: FleetConfigItem[],
): Promise<{ pair: K2KeyPair; check: KeyCheck }> {
  const key = decodeRecoveryCode(code);
  const check = await verifyAgainstFleet(householdId, key, items);
  if (check === 'wrong') throw new WrongRecoveryCodeError();
  const now = new Date().toISOString();
  const pair: K2KeyPair = {
    k2: key,
    kid: `k2-restored-${now.slice(0, 7).replace('-', '')}`,
    nodeId: householdKeyId(householdId),
    createdAt: now,
  };
  await storeK2(pair);
  return { pair, check };
}

/** Give a node the household key through the existing K2 relay; it then pulls fleet config. */
export async function adoptNode(householdId: string, nodeId: string): Promise<void> {
  const kh = await getHouseholdKey(householdId);
  if (!kh) throw new Error('This household has no key yet.');
  await provisionK2ToNode(nodeId, kh.k2, kh.kid, kh.createdAt);
}
