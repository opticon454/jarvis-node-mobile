import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import RecoveryCodeScreen from '../../src/screens/Settings/RecoveryCodeScreen';
import { lightTheme } from '../../src/theme';
import { encodeRecoveryCode } from '../../src/services/recoveryCodeService';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
}));
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ state: { activeHouseholdId: 'hh1' } }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const mockPair = { k2: KEY, kid: 'k2-202611-abc', nodeId: 'household:hh1', createdAt: '2026-11-06T00:00:00Z' };

const mockGetKey = jest.fn();
const mockCreate = jest.fn();
const mockRestore = jest.fn();
const mockAdopt = jest.fn();
jest.mock('../../src/services/householdKeyService', () => {
  const actual = jest.requireActual('../../src/services/householdKeyService');
  return {
    ...actual,
    getHouseholdKey: (...a: unknown[]) => mockGetKey(...a),
    createHouseholdKey: (...a: unknown[]) => mockCreate(...a),
    restoreFromRecoveryCode: (...a: unknown[]) => mockRestore(...a),
    adoptNode: (...a: unknown[]) => mockAdopt(...a),
  };
});
jest.mock('../../src/services/fleetConfigService', () => ({ rotateHouseholdKey: jest.fn() }));
jest.mock('../../src/api/fleetConfigApi', () => ({ listFleetConfig: jest.fn().mockResolvedValue([]) }));
jest.mock('../../src/api/nodeApi', () => ({
  listNodes: jest.fn().mockResolvedValue([
    { node_id: 'n1', room: 'Kitchen' },
    { node_id: 'n2', room: 'Office' },
  ]),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PaperProvider theme={lightTheme}>{children}</PaperProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetKey.mockResolvedValue(null);
  mockAdopt.mockResolvedValue(undefined);
});

describe('RecoveryCodeScreen', () => {
  it('lets a button press through while an input is focused (the first tap must not only blur it)', async () => {
    const { UNSAFE_getByType, findByTestId } = render(<RecoveryCodeScreen />, { wrapper });
    await findByTestId('recovery-input');
    expect(UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('offers to create a key when the household has none, and shows the code once', async () => {
    mockCreate.mockResolvedValue(mockPair);
    const { findByTestId, queryByTestId, getByTestId } = render(<RecoveryCodeScreen />, { wrapper });
    fireEvent.press(await findByTestId('recovery-create'));
    const code = await findByTestId('recovery-code');
    expect(code.props.children).toBe(encodeRecoveryCode(KEY));
    fireEvent.press(getByTestId('recovery-hide'));
    expect(queryByTestId('recovery-code')).toBeNull();
    expect(getByTestId('recovery-show')).toBeTruthy();
  });

  it('keeps the code hidden until asked', async () => {
    mockGetKey.mockResolvedValue(mockPair);
    const { findByTestId, queryByTestId } = render(<RecoveryCodeScreen />, { wrapper });
    await findByTestId('recovery-show');
    expect(queryByTestId('recovery-code')).toBeNull();
  });

  it('restores from a typed code and says whether it was proven', async () => {
    mockRestore.mockResolvedValue({ pair: mockPair, check: 'verified' });
    const { findByTestId, getByTestId } = render(<RecoveryCodeScreen />, { wrapper });
    const input = await findByTestId('recovery-input');
    fireEvent.changeText(input, 'abcde-fghjk');
    await act(async () => {
      fireEvent.press(getByTestId('recovery-restore'));
    });
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('hh1', 'abcde-fghjk', []));
    expect((await findByTestId('recovery-message')).props.children).toMatch(/right key/);
  });

  it('shows the reason when a code is wrong and keeps the screen usable', async () => {
    const { RecoveryCodeError } = jest.requireActual('../../src/services/recoveryCodeService');
    mockRestore.mockRejectedValue(new RecoveryCodeError('checksum', 'The code has a typo: the check digits do not match.'));
    const { findByTestId, getByTestId } = render(<RecoveryCodeScreen />, { wrapper });
    fireEvent.changeText(await findByTestId('recovery-input'), 'x');
    await act(async () => {
      fireEvent.press(getByTestId('recovery-restore'));
    });
    expect((await findByTestId('recovery-message')).props.children).toMatch(/typo/);
  });

  it('gives the key to every node and reports the ones it could not reach', async () => {
    mockGetKey.mockResolvedValue(mockPair);
    mockAdopt.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('504'));
    const { findByTestId } = render(<RecoveryCodeScreen />, { wrapper });
    const adopt = await findByTestId('recovery-adopt');
    await act(async () => {
      fireEvent.press(adopt);
    });
    expect(mockAdopt).toHaveBeenCalledTimes(2);
    expect((await findByTestId('recovery-message')).props.children).toMatch(/Could not reach: Office/);
  });
});
