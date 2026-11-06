import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import FleetConfigScreen, { parseFleetValue } from '../../src/screens/Settings/FleetConfigScreen';
import { lightTheme } from '../../src/theme';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, [cb]);
  },
}));
jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => ({ state: { activeHouseholdId: 'hh1' } }),
}));

const mockGetKey = jest.fn();
jest.mock('../../src/services/householdKeyService', () => ({
  getHouseholdKey: (...a: unknown[]) => mockGetKey(...a),
}));
const mockRead = jest.fn();
const mockSet = jest.fn();
jest.mock('../../src/services/fleetConfigService', () => ({
  FLEET_TYPES: { secrets: 'secrets', nodeSettings: 'node_settings', commandStates: 'command_states' },
  readFleetConfig: (...a: unknown[]) => mockRead(...a),
  setFleetValues: (...a: unknown[]) => mockSet(...a),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PaperProvider theme={lightTheme}>{children}</PaperProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetKey.mockResolvedValue({ k2: 'k' });
  mockRead.mockResolvedValue({});
  mockSet.mockResolvedValue(3);
});

describe('parseFleetValue', () => {
  it('keeps secrets as text and gives settings their JSON types', () => {
    expect(parseFleetValue('secrets', '12345')).toBe('12345');
    expect(parseFleetValue('secrets', 'true')).toBe('true');
    expect(parseFleetValue('nodeSettings', '40')).toBe(40);
    expect(parseFleetValue('nodeSettings', 'False')).toBe(false);
    expect(parseFleetValue('commandStates', 'true')).toBe(true);
    expect(parseFleetValue('nodeSettings', 'bright')).toBe('bright');
    expect(parseFleetValue('nodeSettings', '')).toBe('');
  });
});

describe('FleetConfigScreen', () => {
  it('lets a button press through while an input is focused (the first tap must not only blur it)', async () => {
    const { UNSAFE_getByType, findByTestId } = render(<FleetConfigScreen />, { wrapper });
    await findByTestId('fleet-name');
    expect(UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('sends the user to the recovery screen when there is no household key', async () => {
    mockGetKey.mockResolvedValue(null);
    const { findByTestId } = render(<FleetConfigScreen />, { wrapper });
    fireEvent.press(await findByTestId('fleet-go-recovery'));
    expect(mockNavigate).toHaveBeenCalledWith('RecoveryCode');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('saves a secret for every node, masks it, and reports how many nodes were told', async () => {
    mockRead.mockResolvedValueOnce({}).mockResolvedValue({ WEATHER_API_KEY: 'abc' });
    const { findByTestId, getByTestId } = render(<FleetConfigScreen />, { wrapper });
    fireEvent.changeText(await findByTestId('fleet-name'), 'WEATHER_API_KEY');
    fireEvent.changeText(getByTestId('fleet-value'), 'abc');
    await act(async () => {
      fireEvent.press(getByTestId('fleet-save'));
    });
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('hh1', 'secrets', { WEATHER_API_KEY: 'abc' }));
    expect((await findByTestId('fleet-message')).props.children).toMatch(/Sent to 3 nodes/);
    expect((await findByTestId('fleet-value-WEATHER_API_KEY')).props.children).toBe('••••••••');
  });

  it('removes a value by setting it to null', async () => {
    mockRead.mockResolvedValue({ UNITS: 'metric' });
    const { findByTestId } = render(<FleetConfigScreen />, { wrapper });
    const remove = await findByTestId('fleet-remove-UNITS');
    await act(async () => {
      fireEvent.press(remove);
    });
    expect(mockSet).toHaveBeenCalledWith('hh1', 'secrets', { UNITS: null });
  });

  it('types node settings as numbers', async () => {
    const { findByTestId, getByTestId } = render(<FleetConfigScreen />, { wrapper });
    fireEvent.press(await findByTestId('fleet-tab-node'));
    fireEvent.changeText(await findByTestId('fleet-name'), 'volume_percent');
    fireEvent.changeText(getByTestId('fleet-value'), '40');
    await act(async () => {
      fireEvent.press(getByTestId('fleet-save'));
    });
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('hh1', 'node_settings', { volume_percent: 40 }));
  });
});
