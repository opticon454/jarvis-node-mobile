/**
 * Household recovery code: create, show, restore, hand to every node, rotate.
 * The code is the household key (docs/cc/14-fleet-config-and-recovery.md in jarvis-server), so
 * it is shown only on request and never logged.
 */

import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Card, HelperText, Text, TextInput } from 'react-native-paper';

import { listFleetConfig } from '../../api/fleetConfigApi';
import { listNodes, type NodeInfo } from '../../api/nodeApi';
import { useAuth } from '../../auth/AuthContext';
import { rotateHouseholdKey } from '../../services/fleetConfigService';
import {
  WrongRecoveryCodeError,
  adoptNode,
  createHouseholdKey,
  getHouseholdKey,
  recoveryCodeFor,
  restoreFromRecoveryCode,
} from '../../services/householdKeyService';
import { RecoveryCodeError } from '../../services/recoveryCodeService';
import type { K2KeyPair } from '../../services/k2Service';

const errorText = (e: unknown): string => {
  if (e instanceof RecoveryCodeError || e instanceof WrongRecoveryCodeError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong.';
};

const RecoveryCodeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { state: authState } = useAuth();
  const householdId = authState.activeHouseholdId;

  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState<K2KeyPair | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [code, setCode] = useState<string | null>(null); // shown only while revealed
  const [copied, setCopied] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setKey(await getHouseholdKey(householdId));
      setNodes(await listNodes(householdId));
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ kind: 'ok', text: done });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const pair = await createHouseholdKey(householdId!);
      setKey(pair);
      setCode(recoveryCodeFor(pair));
      return 'Key created. Save the recovery code in your password manager now.';
    });

  const reveal = () => {
    if (!key) return;
    setCode(recoveryCodeFor(key));
    setCopied(false);
  };

  const hide = () => {
    setCode(null);
    setCopied(false);
  };

  const copy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
  };

  const restore = () =>
    run(async () => {
      const items = await listFleetConfig(householdId!);
      const { pair, check } = await restoreFromRecoveryCode(householdId!, restoreText, items);
      setKey(pair);
      setRestoreText('');
      return check === 'verified'
        ? 'Restored. The code opened this household\'s stored settings, so it is the right key.'
        : 'Restored, but nothing is stored for this household yet, so the code could not be checked against it. If a later push will not open, the code was for a different household.';
    });

  const giveToNodes = () =>
    run(async () => {
      const failed: string[] = [];
      for (const n of nodes) {
        try {
          await adoptNode(householdId!, n.node_id);
        } catch {
          failed.push(n.room || n.node_id);
        }
      }
      if (failed.length > 0) {
        throw new Error(`Could not reach: ${failed.join(', ')}. Make sure they are online and try again.`);
      }
      return `The household key is on ${nodes.length} node${nodes.length === 1 ? '' : 's'}. They will now pull the fleet settings.`;
    });

  const rotate = () =>
    Alert.alert(
      'Rotate the household key?',
      'Use this if the recovery code leaked or someone left the household. The old code stops working. Every node must be online to receive the new key; if one is not, run it again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              const res = await rotateHouseholdKey(householdId!, nodes.map((n) => n.node_id));
              const pair = await getHouseholdKey(householdId!);
              setKey(pair);
              if (pair) setCode(recoveryCodeFor(pair));
              return `New key active: ${res.resealed} setting group${res.resealed === 1 ? '' : 's'} resealed, ${res.adopted.length} node${res.adopted.length === 1 ? '' : 's'} updated. Save the new recovery code.`;
            }),
        },
      ],
    );

  if (!householdId) {
    return (
      <View style={styles.centered}>
        <Text>Choose a household first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="recovery-code-screen">
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Recovery code" />
      </Appbar.Header>
      {/* "handled": with the default ("never") the first tap on a button only blurs the focused input. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator testID="recovery-loading" />
        ) : (
          <>
            {message && (
              <HelperText type={message.kind === 'error' ? 'error' : 'info'} visible testID="recovery-message">
                {message.text}
              </HelperText>
            )}

            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleMedium">Household key</Text>
                <Text variant="bodySmall" style={styles.hint}>
                  One key for every node in this household. It stays on your phone and the nodes; the server
                  never has it. Keep the recovery code in a password manager so you can get back in if this
                  phone is lost.
                </Text>
                {key ? (
                  <>
                    <Text variant="bodyMedium" testID="recovery-key-id" style={styles.mt}>
                      Key {key.kid}
                    </Text>
                    {code ? (
                      <>
                        <Text selectable variant="titleMedium" style={styles.code} testID="recovery-code">
                          {code}
                        </Text>
                        <View style={styles.row}>
                          <Button mode="outlined" onPress={copy} testID="recovery-copy">
                            {copied ? 'Copied' : 'Copy'}
                          </Button>
                          <Button onPress={hide} testID="recovery-hide">
                            Hide
                          </Button>
                        </View>
                      </>
                    ) : (
                      <Button mode="contained-tonal" onPress={reveal} style={styles.mt} testID="recovery-show">
                        Show recovery code
                      </Button>
                    )}
                  </>
                ) : (
                  <Button mode="contained" onPress={create} loading={busy} disabled={busy} style={styles.mt} testID="recovery-create">
                    Create household key
                  </Button>
                )}
              </Card.Content>
            </Card>

            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleMedium">Restore on this phone</Text>
                <Text variant="bodySmall" style={styles.hint}>
                  Paste or type the recovery code. Dashes, spaces and lower case are fine. A wrong code never
                  replaces the key already on this phone.
                </Text>
                <TextInput
                  mode="outlined"
                  value={restoreText}
                  onChangeText={setRestoreText}
                  placeholder="XXXXX-XXXXX-XXXXX-..."
                  autoCapitalize="characters"
                  autoCorrect={false}
                  multiline
                  style={styles.mt}
                  testID="recovery-input"
                />
                <Button
                  mode="contained"
                  onPress={restore}
                  disabled={busy || restoreText.trim().length === 0}
                  style={styles.mt}
                  testID="recovery-restore"
                >
                  Restore
                </Button>
              </Card.Content>
            </Card>

            {key && (
              <Card style={styles.card}>
                <Card.Content>
                  <Text variant="titleMedium">Nodes</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    Give the household key to all {nodes.length} node{nodes.length === 1 ? '' : 's'} so they
                    follow the fleet settings. New nodes get it the same way after setup.
                  </Text>
                  <Button mode="contained-tonal" onPress={giveToNodes} disabled={busy || nodes.length === 0} style={styles.mt} testID="recovery-adopt">
                    Give key to all nodes
                  </Button>
                  <Button mode="outlined" onPress={rotate} disabled={busy} style={styles.mt} textColor="#b3261e" testID="recovery-rotate">
                    Rotate key
                  </Button>
                </Card.Content>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: 12 },
  hint: { opacity: 0.7, marginTop: 4 },
  mt: { marginTop: 12 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  code: { fontFamily: 'monospace', marginTop: 12, letterSpacing: 1 },
});

export default RecoveryCodeScreen;
