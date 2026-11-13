import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { useAppState } from '../hooks/useAppState';

import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import BottomTabs from './BottomTabs';
import AlertDetailScreen from '../screens/AlertDetailScreen';
import LoadDetailScreen from '../screens/LoadDetailScreen';
import HealthScoreScreen from '../screens/HealthScoreScreen';
import PredictiveMaintenanceScreen from '../screens/PredictiveMaintenanceScreen';
import EventHistoryScreen from '../screens/EventHistoryScreen';
import RemoteProtectionScreen from '../screens/RemoteProtectionScreen';
import DeviceStatusScreen from '../screens/DeviceStatusScreen';
import DevicesScreen from '../screens/DevicesScreen';
import ArchitectureScreen from '../screens/ArchitectureScreen';
import SettingsScreen from '../screens/SettingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bgPrimary,
    card: colors.panel,
    border: colors.border,
    primary: colors.accent,
    text: colors.text,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.panel },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bgPrimary },
};

export default function RootNavigator() {
  const { user, authLoading, isFirebaseConfigured } = useAppState();
  const [splashDone, setSplashDone] = React.useState(false);

  if (!splashDone) {
    return <SplashScreen onFinished={() => setSplashDone(true)} />;
  }

  // If Firebase Auth isn't configured, skip login and go straight into the
  // app (DEMO MODE) rather than blocking the user with a login screen they
  // can't complete.
  const requiresLogin = isFirebaseConfigured && !authLoading && !user;

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={screenOptions}>
        {requiresLogin ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={BottomTabs} options={{ headerShown: false }} />
            <Stack.Screen name="AlertDetail" component={AlertDetailScreen} options={{ title: 'Alert Detail' }} />
            <Stack.Screen name="LoadDetail" component={LoadDetailScreen} options={{ title: 'Load Detail' }} />
            <Stack.Screen name="HealthScore" component={HealthScoreScreen} options={{ title: 'Electrical Health Score' }} />
            <Stack.Screen name="PredictiveMaintenance" component={PredictiveMaintenanceScreen} options={{ title: 'Predictive Maintenance' }} />
            <Stack.Screen name="EventHistory" component={EventHistoryScreen} options={{ title: 'Event History' }} />
            <Stack.Screen name="RemoteProtection" component={RemoteProtectionScreen} options={{ title: 'Remote Protection' }} />
            <Stack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Devices & ML' }} />
            <Stack.Screen name="DeviceStatus" component={DeviceStatusScreen} options={{ title: 'Device & Connection Status' }} />
            <Stack.Screen name="Architecture" component={ArchitectureScreen} options={{ title: 'System Architecture' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
