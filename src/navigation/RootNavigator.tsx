import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import React from 'react';

import { useAuth } from '../auth/AuthContext';
import ForcePasswordChangeScreen from '../screens/Auth/ForcePasswordChangeScreen';
import AuthNavigator from './AuthNavigator';
import CommandDataStackNavigator from './CommandDataStackNavigator';
import InboxStackNavigator from './InboxStackNavigator';
import MainTabNavigator from './MainTabNavigator';
import MemoriesStackNavigator from './MemoriesStackNavigator';
import CallContextStackNavigator from './CallContextStackNavigator';
import PhonebookStackNavigator from './PhonebookStackNavigator';
import RecentCommandsStackNavigator from './RecentCommandsStackNavigator';
import SmartHomeSetupNavigator from './SmartHomeSetupNavigator';
import HouseholdEditScreen from '../screens/Settings/HouseholdEditScreen';
import FleetConfigScreen from '../screens/Settings/FleetConfigScreen';
import RecoveryCodeScreen from '../screens/Settings/RecoveryCodeScreen';
import SignalAutomationsScreen from '../screens/Settings/SignalAutomationsScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';
import VoiceProfileScreen from '../screens/Settings/VoiceProfileScreen';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator = () => {
  const {
    state: { isAuthenticated, isLoading, mustChangePassword },
  } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <AuthNavigator />;
  }

  // Temp-password session: the whole app tree is swapped out (same pattern as
  // the auth gate above), so there's no back-button escape until a real
  // password is set or the user logs out.
  if (mustChangePassword) {
    return <ForcePasswordChangeScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainTabNavigator} />
      <Stack.Screen
        name="Inbox"
        component={InboxStackNavigator}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="HouseholdEdit" component={HouseholdEditScreen} />
      <Stack.Screen name="SignalAutomations" component={SignalAutomationsScreen} />
      <Stack.Screen name="VoiceProfile" component={VoiceProfileScreen} />
      <Stack.Screen name="RecoveryCode" component={RecoveryCodeScreen} />
      <Stack.Screen name="FleetConfig" component={FleetConfigScreen} />
      <Stack.Screen name="RecentCommands" component={RecentCommandsStackNavigator} />
      <Stack.Screen
        name="SmartHomeSetup"
        component={SmartHomeSetupNavigator}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="CommandData" component={CommandDataStackNavigator} />
      <Stack.Screen
        name="Memories"
        component={MemoriesStackNavigator}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="Phonebook"
        component={PhonebookStackNavigator}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="CallContext"
        component={CallContextStackNavigator}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default RootNavigator;
