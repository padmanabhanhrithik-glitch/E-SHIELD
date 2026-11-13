import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../firebase/firebaseConfig';

const AppStateContext = createContext(null);

const DEMO_MODE_KEY = 'eshield_demo_mode';
const ACTIVE_DEVICE_KEY = 'eshield_active_device';

export function AppStateProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // DEMO MODE is ON by default when Firebase/backend aren't configured yet,
  // so the app is usable out of the box. It can always be toggled manually
  // in Settings once real hardware/backend is wired up.
  const [demoMode, setDemoModeState] = useState(!isFirebaseConfigured);
  const [activeDeviceId, setActiveDeviceIdState] = useState('ESHIELD-NODE-01');

  useEffect(() => {
    AsyncStorage.getItem(DEMO_MODE_KEY).then((val) => {
      if (val !== null) setDemoModeState(val === 'true');
    });
    AsyncStorage.getItem(ACTIVE_DEVICE_KEY).then((val) => {
      if (val) setActiveDeviceIdState(val);
    });
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  const setDemoMode = (value) => {
    setDemoModeState(value);
    AsyncStorage.setItem(DEMO_MODE_KEY, String(value));
  };

  const setActiveDeviceId = (value) => {
    setActiveDeviceIdState(value);
    AsyncStorage.setItem(ACTIVE_DEVICE_KEY, value);
  };

  const value = useMemo(
    () => ({
      user,
      authLoading,
      isFirebaseConfigured,
      demoMode,
      setDemoMode,
      activeDeviceId,
      setActiveDeviceId,
    }),
    [user, authLoading, demoMode, activeDeviceId]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
