import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  HelperText,
  Icon,
  IconButton,
  Portal,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/AuthContext';
import authApi from '../../api/authApi';
import SafeButton from '../../components/SafeButton';
import { HelpIcon } from '../../components/HelpIcon';
import { HelpProvider } from '../../components/HelpProvider';
import { useConfig } from '../../contexts/ConfigContext';
import { helpCopy } from '../../copy/help';
import { useThemePreference, ThemePreference } from '../../theme/ThemeProvider';
import {
  getSmartHomeConfig,
  updateSmartHomeConfig,
  type NodeOption,
  type SmartHomeConfig,
} from '../../api/smartHomeApi';

import type { RootStackParamList } from '../../navigation/types';
import { AUTO_PLAY_TTS_KEY } from '../../config/storageKeys';
import {
  arePushNotificationsEnabled,
  setPushNotificationsEnabled,
} from '../../services/pushNotificationService';
import { clearUserData } from '../../services/clearUserData';
import { getVoiceProfileStatus } from '../../api/voiceProfileApi';
import DisplayNameEditor from '../../components/DisplayNameEditor';
import KeyboardSafeView from '../../components/KeyboardSafeView';
import { NodeKindIcon } from '../../components/NodeKindIcon';
import { useNodeKinds } from '../../hooks/useNodeKinds';
import { isDesktopAgent, nodeDisplayName, NodeKindFields, sortPisFirst } from '../../utils/nodeKind';

const THEME_BUTTONS = [
  { value: 'light', label: 'Light', icon: 'white-balance-sunny', testID: 'theme-light' },
  { value: 'dark', label: 'Dark', icon: 'moon-waning-crescent', testID: 'theme-dark' },
  { value: 'system', label: 'System', icon: 'cellphone', testID: 'theme-system' },
] as const;

/** Gap above the "Settings" title, measured from the top of the screen. */
const HEADER_TOP_MARGIN = 48;

/**
 * A primary-node option's kind: the smart-home config's own node_kind (servers
 * from jarvis-server #176), merged over what the household node list says.
 * With neither, the node counts as a Pi.
 */
const primaryNodeKind = (
  node: NodeOption,
  kinds: Record<string, NodeKindFields>,
): NodeKindFields => ({
  ...kinds[node.node_id],
  ...(node.node_kind !== undefined ? { node_kind: node.node_kind } : {}),
});

const SettingsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const theme = useTheme();
  // Android shows this modal full-screen under a transparent (edge-to-edge)
  // status bar, so keep the scroll area below it — otherwise content scrolls
  // up over the clock. The iOS page sheet already starts below the status bar.
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'android' ? Math.min(insets.top, HEADER_TOP_MARGIN) : 0;
  const {
    state: authState,
    logout,
    deleteAccount,
    switchHousehold,
    fetchHouseholds,
    setBiometricEnabled,
    biometricAvailable,
  } = useAuth();
  const { config, isUsingCloud, manualUrl, rediscover, setManualUrl } =
    useConfig();
  const queryClient = useQueryClient();
  const { paperTheme, themePreference, setThemePreference } = useThemePreference();

  const [urlInput, setUrlInput] = useState(manualUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [autoPlayTTS, setAutoPlayTTS] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  // Household join flow
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState<{ valid: boolean; household_name: string | null } | null>(null);
  const [joinError, setJoinError] = useState('');

  // Household create flow
  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [creatingHousehold, setCreatingHousehold] = useState(false);

  // Delete account flow
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const closeDeleteDialog = useCallback(() => {
    if (deletingAccount) return;
    setShowDeleteAccount(false);
    setDeletePassword('');
    setDeleteConfirmText('');
    setDeleteError('');
  }, [deletingAccount]);

  const handleDeleteAccount = useCallback(async () => {
    setDeletingAccount(true);
    setDeleteError('');
    try {
      // On success (204) the auth-state reset inside deleteAccount drops the
      // app to the AuthNavigator, so there's nothing to clean up here.
      await deleteAccount(deletePassword);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not complete deletion. Please try again.';
      setDeleteError(msg);
      setDeletingAccount(false);
    }
  }, [deleteAccount, deletePassword]);

  const handleValidateJoin = useCallback(async () => {
    const code = joinCode.trim();
    if (!code) { setJoinStatus(null); return; }
    try {
      const res = await authApi.get<{ valid: boolean; household_name: string | null }>(`/invites/${code}/validate`, {
        headers: { Authorization: `Bearer ${authState.accessToken}` },
      });
      setJoinStatus(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 422) {
        setJoinStatus({ valid: false, household_name: null });
      } else {
        console.error('[SettingsScreen] Failed to validate invite code', err);
        setJoinError('Could not validate code. Check your connection.');
      }
    }
  }, [joinCode, authState.accessToken]);

  const handleJoinHousehold = useCallback(async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoinError('');
    try {
      await authApi.post('/households/join', { invite_code: code }, {
        headers: { Authorization: `Bearer ${authState.accessToken}` },
      });
      setJoinCode('');
      setJoinStatus(null);
      fetchHouseholds();
      Alert.alert('Joined!', 'You have joined the household.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to join';
      setJoinError(msg);
    }
  }, [joinCode, authState.accessToken, fetchHouseholds]);

  const handleCreateHousehold = useCallback(async () => {
    const name = newHouseholdName.trim();
    if (!name) return;
    setCreatingHousehold(true);
    try {
      await authApi.post('/households', { name }, {
        headers: { Authorization: `Bearer ${authState.accessToken}` },
      });
      setNewHouseholdName('');
      fetchHouseholds();
      Alert.alert('Created!', `Household "${name}" has been created.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to create household';
      Alert.alert('Error', msg);
    } finally {
      setCreatingHousehold(false);
    }
  }, [newHouseholdName, authState.accessToken, fetchHouseholds]);

  // Smart Home config (device manager + primary node)
  const [smartHomeConfig, setSmartHomeConfig] = useState<SmartHomeConfig | null>(null);
  const [smartHomeLoading, setSmartHomeLoading] = useState(false);

  // Voice profile status
  const [hasVoiceProfile, setHasVoiceProfile] = useState<boolean | null>(null);

  const householdId = authState.activeHouseholdId;
  const nodeKinds = useNodeKinds(
    householdId,
    smartHomeConfig?.nodes.map((n) => n.node_id) ?? [],
  );

  // Load settings
  useEffect(() => {
    AsyncStorage.getItem(AUTO_PLAY_TTS_KEY)
      .then((val) => setAutoPlayTTS(val === 'true'))
      .catch((err) => console.error('[SettingsScreen] Failed to load auto-play setting', err));
    arePushNotificationsEnabled()
      .then(setPushEnabled)
      .catch((err) => console.error('[SettingsScreen] Failed to load push setting', err));
  }, []);

  // Load voice profile status
  useEffect(() => {
    if (householdId) {
      getVoiceProfileStatus(householdId)
        .then((s) => setHasVoiceProfile(s.has_profile))
        .catch(() => setHasVoiceProfile(null));
    }
  }, [householdId]);

  const handleAutoPlayToggle = useCallback(async (value: boolean) => {
    setAutoPlayTTS(value);
    try {
      await AsyncStorage.setItem(AUTO_PLAY_TTS_KEY, value ? 'true' : 'false');
    } catch (err) {
      console.error('[SettingsScreen] Failed to save auto-play setting', err);
    }
  }, []);

  const handlePushToggle = useCallback(async (value: boolean) => {
    setPushEnabled(value);
    await setPushNotificationsEnabled(value);
    if (!value) {
      Alert.alert(
        'Notifications Disabled',
        'Push notifications have been turned off. Restart the app for this to take full effect.',
      );
    }
  }, []);

  const handleBiometricToggle = useCallback(async (value: boolean) => {
    try {
      await setBiometricEnabled(value);
    } catch (err) {
      console.error('[SettingsScreen] Failed to update biometric login', err);
      Alert.alert('Error', 'Could not update biometric login.');
    }
  }, [setBiometricEnabled]);

  useEffect(() => {
    if (!householdId) return;
    setSmartHomeLoading(true);
    getSmartHomeConfig(householdId)
      .then(setSmartHomeConfig)
      .catch((err) => console.error('[SettingsScreen] Failed to load smart home config', err))
      .finally(() => setSmartHomeLoading(false));
  }, [householdId]);

  const handlePrimaryNodeChange = useCallback(
    async (newNodeId: string) => {
      if (!householdId || !smartHomeConfig) return;
      const prev = smartHomeConfig.primary_node_id;
      setSmartHomeConfig((c) => c ? { ...c, primary_node_id: newNodeId } : c);
      try {
        const updated = await updateSmartHomeConfig(householdId, { primary_node_id: newNodeId });
        setSmartHomeConfig((c) => c ? { ...c, ...updated } : c);
      } catch (err) {
        console.error('[SettingsScreen] Failed to update primary node', err);
        setSmartHomeConfig((c) => c ? { ...c, primary_node_id: prev } : c);
        Alert.alert('Error', 'Could not update primary node.');
      }
    },
    [householdId, smartHomeConfig],
  );

  const handleExternalDevicesToggle = useCallback(
    async (value: boolean) => {
      if (!householdId || !smartHomeConfig) return;
      const prev = smartHomeConfig.use_external_devices;
      setSmartHomeConfig((c) => c ? { ...c, use_external_devices: value } : c);
      try {
        const updated = await updateSmartHomeConfig(householdId, { use_external_devices: value });
        setSmartHomeConfig((c) => c ? { ...c, ...updated } : c);
      } catch (err) {
        console.error('[SettingsScreen] Failed to toggle external devices', err);
        setSmartHomeConfig((c) => c ? { ...c, use_external_devices: prev } : c);
        Alert.alert('Error', 'Could not update device management setting.');
      }
    },
    [householdId, smartHomeConfig],
  );

  const handleSaveUrl = async () => {
    const trimmed = urlInput.trim();
    if (trimmed && !trimmed.startsWith('http')) {
      Alert.alert('Invalid URL', 'URL must start with http:// or https://');
      return;
    }
    setSaving(true);
    try {
      await setManualUrl(trimmed || null);
      // Switching environments — wipe per-user / per-env caches so dev
      // nodes, K2 keys, and react-query data don't bleed into prod.
      // Logs the user out (auth tokens are wiped); they re-auth against
      // the new environment.
      await clearUserData({ queryClient });
    } catch {
      Alert.alert('Error', 'Failed to connect to that config service URL.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearUrl = async () => {
    setUrlInput('');
    setSaving(true);
    try {
      await setManualUrl(null);
      // See handleSaveUrl — clearing the URL is also an env change (no
      // server left to talk to), so wipe caches + log out; the user is
      // asked for a server URL again on the landing screen.
      await clearUserData({ queryClient });
    } catch (err) {
      console.error('[SettingsScreen] Failed to clear config URL', err);
      Alert.alert('Error', 'Could not clear the config URL.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal.Host>
    <HelpProvider>
    <KeyboardSafeView style={[styles.container, { backgroundColor: paperTheme.colors.background, paddingTop: topInset }]}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.header, { marginTop: HEADER_TOP_MARGIN - topInset }]}>
        <Text variant="headlineMedium" style={styles.title}>
          Settings
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton} testID="settings-close">
          <Icon source="close" size={24} color={theme.colors.onSurface} />
        </TouchableOpacity>
      </View>

      {/* Account */}
      <Card style={styles.card} testID="settings-section-account">
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Account
          </Text>
          <DisplayNameEditor />
          <Button
            testID="settings-logout"
            mode="outlined"
            onPress={logout}
            style={styles.logoutButton}
          >
            Log Out
          </Button>

          {/* Danger Zone — Delete Account */}
          <View style={[styles.dangerZone, { borderColor: theme.colors.error }]}>
            <Text variant="titleSmall" style={{ color: theme.colors.error, marginBottom: 8 }}>
              Danger Zone
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
              Permanently delete your account and all associated data. This cannot be undone.
            </Text>
            <Button
              mode="outlined"
              textColor={theme.colors.error}
              style={{ borderColor: theme.colors.error, alignSelf: 'flex-start' }}
              onPress={() => setShowDeleteAccount(true)}
              icon="trash-can-outline"
              testID="delete-account-button"
            >
              Delete Account
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* Household */}
      <Card style={styles.card} testID="settings-section-household">
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Household
          </Text>

          {/* Household switcher */}
          {authState.households.length > 0 && (
            <>
              {authState.households.map((h) => {
                const isActive = h.id === authState.activeHouseholdId;
                return (
                  <View key={h.id} style={styles.radioRow} testID={`household-row-${h.id}`}>
                    <TouchableRipple
                      onPress={() => !isActive && switchHousehold(h.id)}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Icon
                          source={isActive ? 'radiobox-marked' : 'radiobox-blank'}
                          size={22}
                          color={isActive ? theme.colors.primary : theme.colors.onSurfaceVariant}
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text variant="bodyMedium" style={{ fontWeight: '500' }} testID={`household-name-${h.id}`}>
                            {h.name}
                          </Text>
                          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} testID={`household-role-${h.id}`}>
                            {h.role.replace('_', ' ')}
                          </Text>
                        </View>
                      </View>
                    </TouchableRipple>
                    {(h.role === 'admin' || h.role === 'power_user') && (
                      <IconButton
                        icon="pencil"
                        size={18}
                        onPress={() => navigation.navigate('HouseholdEdit', { householdId: h.id, householdName: h.name })}
                        testID={`household-edit-${h.id}`}
                        accessibilityLabel="Edit household"
                      />
                    )}
                  </View>
                );
              })}
              <Divider style={{ marginVertical: 12 }} />
            </>
          )}

          {/* Join another household */}
          <Text variant="titleSmall" style={{ fontWeight: '600', marginBottom: 4 }}>
            Join Another Household
          </Text>
          <TextInput
            mode="outlined"
            label="Invite Code"
            value={joinCode}
            onChangeText={(t) => { setJoinCode(t.toUpperCase()); setJoinStatus(null); setJoinError(''); }}
            onBlur={handleValidateJoin}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect={false}
            style={{ fontFamily: 'monospace', letterSpacing: 4, marginBottom: 4 }}
            testID="join-invite-code"
          />
          {joinStatus?.valid && (
            <HelperText type="info" visible style={{ color: theme.colors.primary }}>
              You'll join: {joinStatus.household_name}
            </HelperText>
          )}
          {joinStatus && !joinStatus.valid && (
            <HelperText type="error" visible>
              Invalid or expired invite code
            </HelperText>
          )}
          {joinError ? <HelperText type="error" visible>{joinError}</HelperText> : null}
          <Button
            mode="contained"
            onPress={handleJoinHousehold}
            disabled={!joinStatus?.valid}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            testID="join-household-button"
          >
            Join
          </Button>

          {/* Create new household */}
          <Text variant="titleSmall" style={{ fontWeight: '600', marginTop: 16, marginBottom: 4 }}>
            Create New Household
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              mode="outlined"
              label="Household name"
              value={newHouseholdName}
              onChangeText={setNewHouseholdName}
              dense
              style={{ flex: 1 }}
              onSubmitEditing={handleCreateHousehold}
              testID="create-household-name"
            />
            <Button
              mode="contained"
              onPress={handleCreateHousehold}
              loading={creatingHousehold}
              disabled={!newHouseholdName.trim() || creatingHousehold}
              compact
            >
              Create
            </Button>
          </View>
        </Card.Content>
      </Card>

      {/* Fleet settings and the household recovery code */}
      {householdId && (
        <Card style={styles.card} testID="settings-section-fleet">
          <Card.Content>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              All nodes
            </Text>
            <TouchableRipple testID="settings-fleet-config-row" onPress={() => navigation.navigate('FleetConfig')}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Fleet settings</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    Set a secret or setting once for every node
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
            <Divider style={{ marginVertical: 4 }} />
            <TouchableRipple testID="settings-recovery-code-row" onPress={() => navigation.navigate('RecoveryCode')}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Recovery code</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    Keep it in your password manager to get back in if this phone is lost
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
          </Card.Content>
        </Card>
      )}

      {/* Voice */}
      {householdId && (
        <Card style={styles.card} testID="settings-section-voice">
          <Card.Content>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Voice
            </Text>
            <TouchableRipple testID="settings-voice-profile-row" onPress={() => navigation.navigate('VoiceProfile')}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Voice Profile</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    {hasVoiceProfile === null
                      ? 'Checking...'
                      : hasVoiceProfile
                        ? 'Enrolled — Jarvis recognizes your voice'
                        : 'Not set up — tap to enroll'}
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
            <Divider style={{ marginVertical: 4 }} />
            <TouchableRipple testID="settings-command-feedback-row" onPress={() => navigation.navigate('RecentCommands')}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Command Feedback</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    Rate recent voice commands — helps Jarvis learn your patterns
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
            <Divider style={{ marginVertical: 4 }} />
            <TouchableRipple testID="settings-memories-row" onPress={() => navigation.navigate('Memories')}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Memories</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    What Jarvis remembers about you — review, edit, or forget
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
            <Divider style={{ marginVertical: 4 }} />
            <TouchableRipple
              testID="settings-phonebook-row"
              onPress={() => navigation.navigate('Phonebook')}
            >
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Phonebook</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    Businesses Jarvis can call — numbers, notes, and do-not-call
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
            <Divider testID="settings-call-context-divider" style={{ marginVertical: 4 }} />
            <TouchableRipple
              testID="settings-call-context-row"
              onPress={() => navigation.navigate('CallContext')}
            >
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Call details</Text>
                  <Text variant="bodySmall" style={styles.hint}>
                    Your details Jarvis can use on a call — name, callback
                    number, insurance. Private ones stay back unless asked.
                  </Text>
                </View>
                <Icon source="chevron-right" size={24} />
              </View>
            </TouchableRipple>
          </Card.Content>
        </Card>
      )}

      {/* Appearance */}
      <Card style={styles.card} testID="settings-section-appearance">
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Appearance
          </Text>
          <SegmentedButtons
            value={themePreference}
            onValueChange={(v) => setThemePreference(v as ThemePreference)}
            buttons={THEME_BUTTONS as unknown as Parameters<typeof SegmentedButtons>[0]['buttons']}
          />
        </Card.Content>
      </Card>

      {/* Chat */}
      <Card style={styles.card} testID="settings-section-chat">
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Chat
          </Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">Auto-play responses</Text>
              <Text variant="bodySmall" style={styles.hint}>
                Automatically speak Jarvis responses aloud
              </Text>
            </View>
            <Switch
              value={autoPlayTTS}
              onValueChange={handleAutoPlayToggle}
              testID={autoPlayTTS ? 'auto-play-on' : 'auto-play-off'}
            />
          </View>
        </Card.Content>
      </Card>

      {/* Security — biometric login (only on capable devices) */}
      {biometricAvailable && (
        <Card style={styles.card} testID="settings-section-security">
          <Card.Content>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Security
            </Text>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">Biometric login</Text>
                <Text variant="bodySmall" style={styles.hint}>
                  Require {Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'biometric unlock'} to
                  unlock Jarvis when you open the app. You can always sign in with your password.
                </Text>
              </View>
              <Switch
                value={authState.biometricEnabled}
                onValueChange={handleBiometricToggle}
                testID="biometric-login-toggle"
              />
            </View>
          </Card.Content>
        </Card>
      )}

      {/* Privacy */}
      <Card style={styles.card} testID="settings-section-privacy">
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Privacy
          </Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">Push notifications</Text>
              <Text variant="bodySmall" style={styles.hint}>
                When enabled, alerts are delivered through Expo's push service. Disable for a fully local experience.
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={handlePushToggle}
            />
          </View>
        </Card.Content>
      </Card>

      {/* Connection Status */}
      <Card style={styles.card} testID="settings-section-connection">
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Connection
          </Text>
          <View style={styles.statusRow}>
            <Text variant="bodyMedium">Status:</Text>
            <Chip
              compact
              icon={isUsingCloud ? 'cloud-outline' : 'lan'}
              style={styles.statusChip}
            >
              {isUsingCloud ? 'Cloud' : 'Local'}
            </Chip>
            <HelpIcon text={helpCopy.settings.statusChip} size={16} />
          </View>
          {config.configServiceUrl && (
            <Text variant="bodySmall" style={styles.urlText}>
              Config: {config.configServiceUrl}
            </Text>
          )}
          {config.authBaseUrl && (
            <Text variant="bodySmall" style={styles.urlText}>
              Auth: {config.authBaseUrl}
            </Text>
          )}
          {config.commandCenterUrl && (
            <Text variant="bodySmall" style={styles.urlText}>
              Command Center: {config.commandCenterUrl}
            </Text>
          )}
          <View style={styles.rediscoverRow}>
            <Button
              testID="settings-recheck-connection"
              mode="outlined"
              onPress={rediscover}
              icon="refresh"
            >
              Re-check Connection
            </Button>
            <HelpIcon text={helpCopy.settings.recheckConnection} size={16} />
          </View>
        </Card.Content>
      </Card>

      {/* Smart Home */}
      {householdId && (
        <Card style={styles.card} testID="settings-section-smart-home">
          <Card.Content>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Smart Home
            </Text>

            {smartHomeLoading ? (
              <ActivityIndicator size="small" style={{ marginVertical: 12 }} />
            ) : smartHomeConfig ? (
              <>
                {/* Primary Node */}
                {smartHomeConfig.nodes.length > 0 && (
                  <>
                    <Divider style={{ marginVertical: 12 }} />
                    <Text variant="titleSmall" style={{ fontWeight: '600', marginBottom: 4 }}>
                      Primary Node
                    </Text>
                    <Text variant="bodySmall" style={[styles.hint, { marginBottom: 8 }]}>
                      The node that handles device discovery for your household
                    </Text>
                    {sortPisFirst(smartHomeConfig.nodes, (n) => primaryNodeKind(n, nodeKinds)).map((node, i, arr) => {
                      const isSelected = node.node_id === smartHomeConfig.primary_node_id;
                      const kind = primaryNodeKind(node, nodeKinds);
                      const isComputer = isDesktopAgent(kind);
                      const name = nodeDisplayName(
                        { ...node, ...kind, name: node.name !== undefined ? node.name : nodeKinds[node.node_id]?.name },
                        '',
                      );
                      const label = name
                        ? `${name} (${node.node_id.slice(0, 8)}…)`
                        : node.node_id.slice(0, 16) + '…';
                      return (
                        <View key={node.node_id} testID={`primary-node-row-${node.node_id}`}>
                          <TouchableRipple onPress={() => handlePrimaryNodeChange(node.node_id)}>
                            <View style={styles.radioRow}>
                              <Icon
                                source={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                                size={22}
                                color={isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant}
                              />
                              <NodeKindIcon
                                node={kind}
                                size={20}
                                testID={`primary-node-kind-${node.node_id}`}
                                style={{ marginLeft: 12 }}
                              />
                              <View style={{ flex: 1, marginLeft: 8 }}>
                                <Text variant="bodyMedium" style={{ fontWeight: '500' }}>
                                  {label}
                                </Text>
                                {isComputer && (
                                  <Text
                                    variant="bodySmall"
                                    style={styles.hint}
                                    testID={`primary-node-note-${node.node_id}`}
                                  >
                                    {helpCopy.settings.primaryNodeComputer}
                                  </Text>
                                )}
                              </View>
                            </View>
                          </TouchableRipple>
                          {i < arr.length - 1 && <Divider style={{ marginVertical: 2 }} />}
                        </View>
                      );
                    })}
                  </>
                )}

                {/* Use External Devices toggle */}
                <Divider style={{ marginVertical: 12 }} />
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text variant="bodyMedium">Use External Devices</Text>
                      <HelpIcon text={helpCopy.settings.useExternalDevices} size={16} />
                    </View>
                    <Text variant="bodySmall" style={styles.hint}>
                      Show devices from your device manager (read-only)
                    </Text>
                  </View>
                  <Switch
                    value={smartHomeConfig.use_external_devices}
                    onValueChange={handleExternalDevicesToggle}
                    testID="use-external-devices-toggle"
                  />
                </View>
              </>
            ) : (
              <Text variant="bodySmall" style={styles.hint}>
                Could not load smart home settings
              </Text>
            )}
          </Card.Content>
        </Card>
      )}

      {/* Manual Config URL */}
      <Card style={styles.card} testID="settings-section-config-url">
        <Card.Content>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Config Service URL
            </Text>
            <HelpIcon text={helpCopy.settings.configServiceUrl} size={16} />
          </View>
          <Text variant="bodySmall" style={styles.hint}>
            The address of your Jarvis server, e.g.
            http://192.168.1.100:7700. Required — the app doesn't search the
            network for it.
          </Text>
          <TextInput
            mode="outlined"
            label="Config Service URL"
            placeholder="http://192.168.1.100:7700"
            value={urlInput}
            onChangeText={setUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          <View style={styles.urlActions}>
            <Button
              mode="contained"
              onPress={handleSaveUrl}
              loading={saving}
              disabled={saving}
              style={styles.saveButton}
            >
              Save & Connect
            </Button>
            {manualUrl && (
              <Button
                mode="text"
                onPress={handleClearUrl}
                disabled={saving}
              >
                Clear server URL
              </Button>
            )}
          </View>
        </Card.Content>
      </Card>

      <Divider style={styles.divider} />
      <Text variant="bodySmall" style={styles.version}>
        Jarvis Mobile v{require('../../../app.json').expo.version}
      </Text>

    </ScrollView>
    </KeyboardSafeView>

    {/* Delete Account confirmation dialog */}
    <Portal>
      <Dialog visible={showDeleteAccount} onDismiss={closeDeleteDialog} testID="delete-account-dialog">
        <Dialog.Title>Delete Account</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={{ marginBottom: 16, color: theme.colors.onSurfaceVariant }}>
            This permanently deletes your account and all associated data. This action cannot be undone.
          </Text>

          <TextInput
            mode="outlined"
            label="Password"
            value={deletePassword}
            onChangeText={(t) => { setDeletePassword(t); setDeleteError(''); }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            disabled={deletingAccount}
            style={{ marginBottom: 12 }}
            testID="delete-account-password"
          />

          <Text variant="bodySmall" style={{ marginBottom: 4, color: theme.colors.onSurfaceVariant }}>
            Type DELETE to confirm.
          </Text>
          <TextInput
            mode="outlined"
            label="Confirm"
            value={deleteConfirmText}
            onChangeText={(t) => { setDeleteConfirmText(t); setDeleteError(''); }}
            autoCapitalize="characters"
            autoCorrect={false}
            disabled={deletingAccount}
            placeholder="DELETE"
            testID="delete-account-confirm"
          />

          {deleteError ? (
            <HelperText type="error" visible style={{ marginTop: 4 }}>
              {deleteError}
            </HelperText>
          ) : null}

          {deletingAccount && (
            <ActivityIndicator size="small" style={{ marginTop: 12 }} testID="delete-account-spinner" />
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={closeDeleteDialog} disabled={deletingAccount}>Cancel</Button>
          <SafeButton
            onPress={handleDeleteAccount}
            disabled={deletingAccount || deletePassword.length === 0 || deleteConfirmText !== 'DELETE'}
            textColor={theme.colors.error}
            testID="delete-account-confirm-button"
          >
            Delete Account
          </SafeButton>
        </Dialog.Actions>
      </Dialog>
    </Portal>
    </HelpProvider>
    </Portal.Host>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeButton: { padding: 4 },
  title: { fontWeight: 'bold' },
  card: { marginBottom: 16 },
  sectionTitle: { fontWeight: '600', marginBottom: 8 },
  logoutButton: { alignSelf: 'flex-start', marginTop: 4 },
  dangerZone: {
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusChip: {},
  urlText: { opacity: 0.5, marginBottom: 2, fontFamily: 'monospace' },
  rediscoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  hint: { opacity: 0.5, marginBottom: 12 },
  input: { marginBottom: 12 },
  urlActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveButton: { flex: 0 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  divider: { marginVertical: 16 },
  version: { textAlign: 'center', opacity: 0.4 },
});

export default SettingsScreen;
