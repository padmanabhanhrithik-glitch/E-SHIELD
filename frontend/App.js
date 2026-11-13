import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStateProvider } from './src/hooks/useAppState';
import RootNavigator from './src/navigation/RootNavigator';
import { registerForPushNotificationsAsync } from './src/services/notificationService';

export default function App() {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('[E-SHIELD] Service worker registration failed:', err?.message || err);
        });
      }, { once: true });
    }

    // Never allow notification setup to block or crash app startup.
    registerForPushNotificationsAsync()
      .then((r) => {
        if (!r?.supported) console.log('[E-SHIELD] Notifications:', r?.reason);
      })
      .catch((err) => console.warn('[E-SHIELD] Notification init failed:', err?.message || err));
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStateProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
