/**
 * Fleet config: seal once with the household key, store on jarvisd as ciphertext, and every
 * node of the household (current and future) pulls and applies it
 * (docs/cc/14-fleet-config-and-recovery.md in jarvis-server).
 *
 * jarvisd never sees plaintext or the key. A per-node push (configPushService) still works and,
 * because a node applies each fleet revision once, wins until the next fleet change.
 */

import { aesGcmDecrypt, aesGcmEncrypt, randomBytes } from 'jarvis-crypto';

import {
  FleetConfigItem,
  deleteFleetConfig,
  listFleetConfig,
  putFleetConfig,
} from '../api/fleetConfigApi';
import {
  adoptNode,
  clearPreviousHouseholdKey,
  fleetAad,
  getHouseholdKey,
  getPreviousHouseholdKey,
  householdKeyId,
  previousKeyId,
} from './householdKeyService';
import { K2KeyPair, generateK2, storeK2 } from './k2Service';

/** The config types nodes understand today. Others are stored but a node logs and ignores them. */
export const FLEET_TYPES = {
  /** { SECRET_NAME: value }: integration secrets (API keys, passwords). */
  secrets: 'secrets',
  /** { led_brightness_percent: 40, volume_percent: 60, ... }: the keys update_node_config takes. */
  nodeSettings: 'node_settings',
  /** { command_name: enabled }: which commands every node offers. */
  commandStates: 'command_states',
} as const;

export type FleetValues = Record<string, string | number | boolean>;

const utf8ToBase64url = (str: string): string => {
  let binary = '';
  for (const b of new TextEncoder().encode(str)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64urlToUtf8 = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

async function seal(householdId: string, key: string, configType: string, values: FleetValues) {
  const nonce = await randomBytes(12);
  const { ciphertext, tag } = await aesGcmEncrypt(
    key,
    nonce,
    utf8ToBase64url(JSON.stringify(values)),
    fleetAad(householdId, configType),
  );
  return { ciphertext, nonce, tag };
}

async function open(householdId: string, key: string, item: FleetConfigItem): Promise<FleetValues> {
  const pt = await aesGcmDecrypt(
    key,
    item.nonce,
    item.ciphertext,
    item.tag,
    fleetAad(householdId, item.config_type),
  );
  return JSON.parse(base64urlToUtf8(pt)) as FleetValues;
}

async function requireKey(householdId: string): Promise<K2KeyPair> {
  const kh = await getHouseholdKey(householdId);
  if (!kh) throw new Error('This household has no key on this phone. Create one or restore from the recovery code.');
  return kh;
}

/** What the household holds for one type, decrypted on this phone. Empty when nothing is stored. */
export async function readFleetConfig(householdId: string, configType: string): Promise<FleetValues> {
  const kh = await requireKey(householdId);
  const item = (await listFleetConfig(householdId)).find((i) => i.config_type === configType);
  return item ? open(householdId, kh.k2, item) : {};
}

/**
 * Set values for the whole fleet. The server keeps one blob per type, so the current values are
 * read, merged with `patch` (a null value removes the key) and sealed again. Returns how many
 * nodes were notified.
 */
export async function setFleetValues(
  householdId: string,
  configType: string,
  patch: Record<string, string | number | boolean | null>,
): Promise<number> {
  const kh = await requireKey(householdId);
  const merged: FleetValues = { ...(await readFleetConfig(householdId, configType)) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const res = await putFleetConfig(householdId, configType, await seal(householdId, kh.k2, configType, merged));
  return res.nodes_notified;
}

export const clearFleetConfig = (householdId: string, configType: string): Promise<void> =>
  deleteFleetConfig(householdId, configType);

export interface RotationResult {
  resealed: number;
  adopted: string[];
}

/**
 * Replace the household key (a leaked code, or someone leaving the household). Every stored item
 * is opened with the old key, sealed with a new one and written back, then each node is given the
 * new key through the K2 relay. The old key is kept (as `previous`) until everything has been
 * done, so a rotation that stops half way can be run again.
 */
export async function rotateHouseholdKey(householdId: string, nodeIds: string[]): Promise<RotationResult> {
  const current = await requireKey(householdId);
  const previous = await getPreviousHouseholdKey(householdId);
  const items = await listFleetConfig(householdId);

  // Open everything first: a failure here changes nothing. A resumed rotation has items under
  // either key.
  const plain: Array<{ type: string; values: FleetValues }> = [];
  for (const item of items) {
    let values: FleetValues | null = null;
    for (const k of [current.k2, previous?.k2]) {
      if (!k) continue;
      try {
        values = await open(householdId, k, item);
        break;
      } catch {
        // try the other key
      }
    }
    if (!values) throw new Error(`Cannot open "${item.config_type}" with this phone's keys; nothing was changed.`);
    plain.push({ type: item.config_type, values });
  }

  let next = current;
  if (!previous) {
    // Not resuming: keep the old key until this finishes, then switch.
    await storeK2({ ...current, nodeId: previousKeyId(householdId) });
    next = await generateK2(householdKeyId(householdId));
    await storeK2(next);
  }
  for (const p of plain) {
    await putFleetConfig(householdId, p.type, await seal(householdId, next.k2, p.type, p.values));
  }
  const adopted: string[] = [];
  for (const nodeId of nodeIds) {
    await adoptNode(householdId, nodeId);
    adopted.push(nodeId);
  }
  await clearPreviousHouseholdKey(householdId);
  return { resealed: plain.length, adopted };
}
