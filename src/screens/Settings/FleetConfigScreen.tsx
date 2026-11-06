/**
 * Fleet configuration: set a secret or node setting once and every node of the household (and
 * any node added later) receives it. Sealed on this phone with the household key; the server
 * stores ciphertext only (docs/cc/14-fleet-config-and-recovery.md in jarvis-server).
 */

import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Card, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { useAuth } from '../../auth/AuthContext';
import {
  FLEET_TYPES,
  type FleetValues,
  readFleetConfig,
  setFleetValues,
} from '../../services/fleetConfigService';
import { getHouseholdKey } from '../../services/householdKeyService';

type Tab = keyof typeof FLEET_TYPES;

/** Secrets stay text; settings and command states keep their JSON types. */
export const parseFleetValue = (tab: Tab, raw: string): string | number | boolean => {
  if (tab === 'secrets') return raw;
  const t = raw.trim();
  if (t.toLowerCase() === 'true') return true;
  if (t.toLowerCase() === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return raw;
};

const HINTS: Record<Tab, string> = {
  secrets: 'Integration secrets such as an API key. Values are hidden here.',
  nodeSettings: 'Node settings such as volume_percent, led_brightness_percent or is_muted.',
  commandStates: 'Turn a command on or off for every node: name = true or false.',
};

const FleetConfigScreen: React.FC = () => {
  const navigation = useNavigation();
  const { state: authState } = useAuth();
  const householdId = authState.activeHouseholdId;

  const [tab, setTab] = useState<Tab>('secrets');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [values, setValues] = useState<FleetValues>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const kh = await getHouseholdKey(householdId);
      setHasKey(kh !== null);
      setValues(kh ? await readFleetConfig(householdId, FLEET_TYPES[tab]) : {});
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load.' });
    } finally {
      setLoading(false);
    }
  }, [householdId, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (patch: Record<string, string | number | boolean | null>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const notified = await setFleetValues(householdId!, FLEET_TYPES[tab], patch);
      setValues(await readFleetConfig(householdId!, FLEET_TYPES[tab]));
      setMessage({ kind: 'ok', text: `${done} Sent to ${notified} node${notified === 1 ? '' : 's'}; offline nodes catch up when they reconnect.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const key = name.trim();
    if (!key) return;
    await apply({ [key]: parseFleetValue(tab, value) }, `${key} saved.`);
    setName('');
    setValue('');
  };

  return (
    <View style={styles.root} testID="fleet-config-screen">
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Fleet settings" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.content}>
        {!householdId ? (
          <Text>Choose a household first.</Text>
        ) : hasKey === false ? (
          <Card>
            <Card.Content>
              <Text variant="titleMedium">No household key on this phone</Text>
              <Text variant="bodySmall" style={styles.hint}>
                Create one, or restore it from your recovery code, before setting fleet values.
              </Text>
              <Button mode="contained" onPress={() => (navigation as any).navigate('RecoveryCode')} style={styles.mt} testID="fleet-go-recovery">
                Open recovery code
              </Button>
            </Card.Content>
          </Card>
        ) : (
          <>
            <SegmentedButtons
              value={tab}
              onValueChange={(v) => setTab(v as Tab)}
              buttons={[
                { value: 'secrets', label: 'Secrets', testID: 'fleet-tab-secrets' },
                { value: 'nodeSettings', label: 'Node', testID: 'fleet-tab-node' },
                { value: 'commandStates', label: 'Commands', testID: 'fleet-tab-commands' },
              ]}
            />
            <Text variant="bodySmall" style={styles.hint}>{HINTS[tab]}</Text>
            {message && (
              <HelperText type={message.kind === 'error' ? 'error' : 'info'} visible testID="fleet-message">
                {message.text}
              </HelperText>
            )}
            {loading ? (
              <ActivityIndicator testID="fleet-loading" />
            ) : (
              <>
                {Object.keys(values).length === 0 && (
                  <Text variant="bodyMedium" style={styles.hint} testID="fleet-empty">Nothing set for the whole fleet yet.</Text>
                )}
                {Object.entries(values).map(([k, v]) => (
                  <Card key={k} style={styles.mt}>
                    <Card.Content style={styles.entry}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium">{k}</Text>
                        <Text variant="bodySmall" style={styles.hint} testID={`fleet-value-${k}`}>
                          {tab === 'secrets' ? '••••••••' : String(v)}
                        </Text>
                      </View>
                      <Button onPress={() => void apply({ [k]: null }, `${k} removed.`)} disabled={busy} testID={`fleet-remove-${k}`}>
                        Remove
                      </Button>
                    </Card.Content>
                  </Card>
                ))}
                <Card style={styles.mt}>
                  <Card.Content>
                    <TextInput mode="outlined" label="Name" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} testID="fleet-name" />
                    <TextInput
                      mode="outlined"
                      label="Value"
                      value={value}
                      onChangeText={setValue}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={tab === 'secrets'}
                      style={styles.mt}
                      testID="fleet-value"
                    />
                    <Button mode="contained" onPress={add} disabled={busy || name.trim() === ''} loading={busy} style={styles.mt} testID="fleet-save">
                      Save for all nodes
                    </Button>
                  </Card.Content>
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 8 },
  hint: { opacity: 0.7, marginTop: 4 },
  mt: { marginTop: 12 },
  entry: { flexDirection: 'row', alignItems: 'center' },
});

export default FleetConfigScreen;
