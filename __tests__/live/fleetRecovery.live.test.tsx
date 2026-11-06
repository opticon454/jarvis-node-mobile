/**
 * End-to-end: the app's real services against a real jarvisd and real jarvis-agent nodes.
 * Skipped unless JARVIS_LIVE_CC is set; scripts/e2e-fleet-config (in jarvis-server) runs it.
 *
 *   PHASE=1  create the household key, push fleet config, give node A the key, check it applied,
 *            wipe the app, restore from the recovery code, push a change, check A applied it.
 *   PHASE=2  a NEW phone (only the recovery code): add node B after the key exists, and check B
 *            received everything the household already held with no secret re-entered.
 *
 * Env: JARVIS_LIVE_CC, JARVIS_LIVE_TOKEN, JARVIS_LIVE_HOUSEHOLD, JARVIS_LIVE_NODE (node id),
 *      JARVIS_LIVE_NODE_DIR (the agent's config dir) and JARVIS_LIVE_NODE_KEY (its at-rest key
 *      file), JARVIS_LIVE_NODE_LOG (agent.log), JARVIS_LIVE_CODE_FILE (where the code is kept).
 */
import * as crypto from 'crypto';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import * as fs from 'fs';
import * as path from 'path';

import { FLEET_TYPES, readFleetConfig, setFleetValues } from '../../src/services/fleetConfigService';
import {
  adoptNode,
  createHouseholdKey,
  getHouseholdKey,
  recoveryCodeFor,
  restoreFromRecoveryCode,
} from '../../src/services/householdKeyService';
import { listFleetConfig } from '../../src/api/fleetConfigApi';
import FleetConfigScreen from '../../src/screens/Settings/FleetConfigScreen';
import RecoveryCodeScreen from '../../src/screens/Settings/RecoveryCodeScreen';
import { lightTheme } from '../../src/theme';

jest.mock('jarvis-crypto', () => require('../helpers/nodeCrypto'));

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('../../src/config/serviceConfig', () => ({ getCommandCenterUrl: () => process.env.JARVIS_LIVE_CC }));
// axios in the React Native build has no Node adapter, so requests go through node:http.
jest.mock('../../src/api/apiClient', () => {
  const http = require('http');
  const adapter = (config: any) =>
    new Promise((resolve, reject) => {
      const url = new URL(config.url, config.baseURL);
      const body = config.data == null ? undefined : typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
      const headers: Record<string, string> = { Authorization: `Bearer ${process.env.JARVIS_LIVE_TOKEN}` };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(body));
      }
      const req = http.request(url, { method: String(config.method).toUpperCase(), headers }, (res: any) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c));
        res.on('end', () => {
          let data: unknown = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            // leave as text
          }
          const response = { data, status: res.statusCode, statusText: res.statusMessage, headers: res.headers, config, request: req };
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(response);
          else reject(Object.assign(new Error(`HTTP ${res.statusCode} ${url.pathname}: ${text}`), { response }));
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  return { __esModule: true, default: require('axios').create({ adapter }) };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, [cb]);
  },
}));
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ state: { activeHouseholdId: process.env.JARVIS_LIVE_HOUSEHOLD } }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const live = process.env.JARVIS_LIVE_CC ? describe : describe.skip;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The node's log says it applied this type at this revision (or later). */
type LiveNode = { id: string; dir: string; key: string; log: string };
const single = (): LiveNode => ({ id: env('JARVIS_LIVE_NODE'), dir: env('JARVIS_LIVE_NODE_DIR'), key: env('JARVIS_LIVE_NODE_KEY'), log: env('JARVIS_LIVE_NODE_LOG') });

async function waitApplied(configType: string, minRevision: number, ms = 30000, n: LiveNode = single()): Promise<void> {
  const log = n.log;
  const re = new RegExp(`fleet: config applied.*config_type=${configType} revision=(\\d+)`, 'g');
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const text = fs.readFileSync(log, 'utf8');
    for (const m of text.matchAll(re)) if (Number(m[1]) >= minRevision) return;
    await sleep(500);
  }
  throw new Error(`node never applied ${configType} revision ${minRevision}; see ${log}`);
}

/** Read the node's sealed node-settings.json with its at-rest key: proves what is on disk. */
function nodeSecrets(n: LiveNode = single()): { raw: string; secrets: Record<string, string> } {
  const raw = fs.readFileSync(path.join(n.dir, 'node-settings.json'), 'utf8');
  const env_ = JSON.parse(raw);
  const key = Buffer.from(fs.readFileSync(n.key, 'utf8').trim(), 'base64url');
  const ct = Buffer.from(env_.ct, 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env_.nonce, 'base64url'));
  d.setAAD(Buffer.from('jarvis-at-rest:node-settings.json'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString());
  const secrets: Record<string, string> = {};
  for (const s of plain.secrets ?? []) secrets[s.key] = s.value;
  return { raw, secrets };
}

const HH = process.env.JARVIS_LIVE_HOUSEHOLD ?? '';

live('fleet config and recovery, end to end', () => {
  jest.setTimeout(240000);

  (process.env.PHASE === '1' ? it : it.skip)('phase 1: push, apply, wipe the app, restore from the code, push again', async () => {
    const node = env('JARVIS_LIVE_NODE');
    const kh = await createHouseholdKey(HH);
    const code = recoveryCodeFor(kh);
    fs.writeFileSync(env('JARVIS_LIVE_CODE_FILE'), code + '\n', { mode: 0o600 });

    await setFleetValues(HH, FLEET_TYPES.secrets, { E2E_SECRET: 'one', E2E_OTHER: 'keep' });
    await setFleetValues(HH, FLEET_TYPES.nodeSettings, { led_brightness_percent: 40 });
    await setFleetValues(HH, FLEET_TYPES.commandStates, { e2e_command: false });
    // Ciphertext only on the server.
    const stored = JSON.stringify(await listFleetConfig(HH));
    expect(stored).not.toContain('one');
    expect(stored).not.toContain('E2E_SECRET');

    await adoptNode(HH, node); // the K2 relay; the node then pulls what the household holds
    await waitApplied('secrets', 1);
    await waitApplied('node_settings', 1);
    await waitApplied('command_states', 1);
    let n = nodeSecrets();
    expect(n.secrets).toMatchObject({ E2E_SECRET: 'one', E2E_OTHER: 'keep' });
    expect(n.raw).not.toContain('E2E_SECRET'); // sealed at rest

    // Lose the phone: the app's storage is gone, only the recovery code survives.
    mockStore.clear();
    expect(await getHouseholdKey(HH)).toBeNull();
    const typed = fs.readFileSync(env('JARVIS_LIVE_CODE_FILE'), 'utf8').trim().toLowerCase().replace(/-/g, ' ');
    const { check } = await restoreFromRecoveryCode(HH, typed, await listFleetConfig(HH));
    expect(check).toBe('verified'); // opened what the server holds, so it is the right key
    expect(await readFleetConfig(HH, FLEET_TYPES.secrets)).toMatchObject({ E2E_SECRET: 'one' });

    // A wrong code is refused and changes nothing.
    await expect(restoreFromRecoveryCode(HH, '04002-0G30G-2GC1R-81450-P30D1-R7H04-8J2CA-1A5GQ-30CHM-6RW3M-F1ZH5-2G5CG', await listFleetConfig(HH))).rejects.toThrow(/not this household/);

    // From the restored phone, change a value for the whole fleet; the node applies it.
    await setFleetValues(HH, FLEET_TYPES.secrets, { E2E_SECRET: 'two' });
    await waitApplied('secrets', 2); // revisions count per config type
    n = nodeSecrets();
    expect(n.secrets).toMatchObject({ E2E_SECRET: 'two', E2E_OTHER: 'keep' });
  });

  (process.env.PHASE === '2' ? it : it.skip)('phase 2: a new phone adds a node after the key exists', async () => {
    const node = env('JARVIS_LIVE_NODE');
    // A fresh phone: nothing but the recovery code.
    expect(await getHouseholdKey(HH)).toBeNull();
    const code = fs.readFileSync(env('JARVIS_LIVE_CODE_FILE'), 'utf8').trim();
    const { check } = await restoreFromRecoveryCode(HH, code, await listFleetConfig(HH));
    expect(check).toBe('verified');

    await adoptNode(HH, node); // the only step for the new node; no secret is entered
    await waitApplied('secrets', 2); // revisions count per config type
    await waitApplied('node_settings', 1);
    await waitApplied('command_states', 1);
    const n = nodeSecrets();
    expect(n.secrets).toMatchObject({ E2E_SECRET: 'two', E2E_OTHER: 'keep' });
    expect(n.raw).not.toContain('E2E_SECRET');
  });

  // The same flow through the real screens: taps and typing, with no service mocked.
  (process.env.PHASE === '3' ? it : it.skip)('phase 3: through the screens, on a new phone with only the code', async () => {
    const nodes: LiveNode[] = JSON.parse(env('JARVIS_LIVE_NODES'));
    const wrapper = ({ children }: { children: React.ReactNode }) => <PaperProvider theme={lightTheme}>{children}</PaperProvider>;
    expect(await getHouseholdKey(HH)).toBeNull(); // nothing on this phone yet

    // Fleet settings without a key sends the user to the recovery screen.
    const fleet0 = render(<FleetConfigScreen />, { wrapper });
    fireEvent.press(await fleet0.findByTestId('fleet-go-recovery', {}, { timeout: 10000 }));
    expect(mockNavigate).toHaveBeenCalledWith('RecoveryCode');
    fleet0.unmount();

    // Recovery screen: a wrong code is refused with a reason and nothing is stored.
    const rec = render(<RecoveryCodeScreen />, { wrapper });
    const input = await rec.findByTestId('recovery-input', {}, { timeout: 10000 });
    fireEvent.changeText(input, '04002-0G30G-2GC1R-81450-P30D1-R7H04-8J2CA-1A5GQ-30CHM-6RW3M-F1ZH5-2G5CG');
    await act(async () => { fireEvent.press(rec.getByTestId('recovery-restore')); });
    await waitFor(() => expect(rec.getByTestId('recovery-message').props.children).toMatch(/not this household/), { timeout: 10000 });
    expect(await getHouseholdKey(HH)).toBeNull();
    // A typo is explained.
    fireEvent.changeText(input, 'ABCDE-FGHJK');
    await act(async () => { fireEvent.press(rec.getByTestId('recovery-restore')); });
    await waitFor(() => expect(rec.getByTestId('recovery-message').props.children).toMatch(/characters/), { timeout: 10000 });

    // The real code, typed the way a person would (lower case, spaces), restores and is proven.
    const code = fs.readFileSync(env('JARVIS_LIVE_CODE_FILE'), 'utf8').trim().toLowerCase().replace(/-/g, ' ');
    fireEvent.changeText(input, code);
    await act(async () => { fireEvent.press(rec.getByTestId('recovery-restore')); });
    await waitFor(() => expect(rec.getByTestId('recovery-message').props.children).toMatch(/right key/), { timeout: 10000 });
    expect(await getHouseholdKey(HH)).not.toBeNull();

    // Give the key to every node from the screen.
    // The sandbox household also has seeded nodes (kitchen, living_room) with no agent behind
    // them: the screen must name those and not the two real nodes (room "desktop").
    await act(async () => { fireEvent.press(await rec.findByTestId('recovery-adopt', {}, { timeout: 10000 })); });
    await waitFor(() => expect(rec.getByTestId('recovery-message').props.children).toMatch(/^Could not reach: kitchen, living_room\. Make sure/), { timeout: 90000 });
    rec.unmount();

    // Fleet settings: save a secret for all nodes by typing and tapping, then see it masked.
    const fleet = render(<FleetConfigScreen />, { wrapper });
    fireEvent.changeText(await fleet.findByTestId('fleet-name', {}, { timeout: 10000 }), 'UI_SECRET');
    fireEvent.changeText(fleet.getByTestId('fleet-value'), 'from-the-screen');
    await act(async () => { fireEvent.press(fleet.getByTestId('fleet-save')); });
    await waitFor(() => expect(fleet.getByTestId('fleet-message').props.children).toMatch(/Sent to \d+ nodes?/), { timeout: 15000 });
    expect(fleet.getByTestId('fleet-value-UI_SECRET').props.children).toBe('••••••••');
    const rev = Number((await listFleetConfig(HH)).find((i) => i.config_type === 'secrets')!.revision);
    for (const n of nodes) {
      await waitApplied('secrets', rev, 30000, n);
      expect(nodeSecrets(n).secrets).toMatchObject({ UI_SECRET: 'from-the-screen', E2E_SECRET: 'two' });
    }

    // Remove it again from the screen; both nodes apply the removal.
    await act(async () => { fireEvent.press(fleet.getByTestId('fleet-remove-UI_SECRET')); });
    await waitFor(() => expect(fleet.getByTestId('fleet-message').props.children).toMatch(/UI_SECRET removed/), { timeout: 15000 });
    for (const n of nodes) await waitApplied('secrets', rev + 1, 30000, n);
    expect(Object.keys((await readFleetConfig(HH, FLEET_TYPES.secrets)))).not.toContain('UI_SECRET');
    fleet.unmount();
  });
});
