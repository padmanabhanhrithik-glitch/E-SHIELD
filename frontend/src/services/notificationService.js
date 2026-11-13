// Environment-aware notification service.
//
// Expo Go (SDK 53+) no longer supports Android remote push, and merely
// importing `expo-notifications` there triggers push-token code at module load
// time. So the module is NEVER imported statically: it is required lazily, and
// only in development builds / production builds. Every export here is
// non-throwing.
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const EXPO_GO_REASON = 'Remote push notifications are unavailable in Expo Go';
export const EXPO_GO_MESSAGE = 'Remote push notifications require an E-SHIELD development build.';

/** 'web' | 'expo-go' | 'development-build' | 'production' */
export function getNotificationEnvironment() {
  if (Platform.OS === 'web') return 'web';
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return 'expo-go';
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'development-build' : 'production';
}

let cachedModule;
function getNotificationsModule() {
  if (cachedModule !== undefined) return cachedModule;
  const env = getNotificationEnvironment();
  if (env === 'web' || env === 'expo-go') {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // eslint-disable-next-line global-require
    cachedModule = require('expo-notifications');
  } catch (err) {
    console.warn('[notificationService] expo-notifications unavailable:', err?.message || err);
    cachedModule = null;
  }
  return cachedModule;
}

let handlerInstalled = false;
function ensureHandler(Notifications) {
  if (handlerInstalled) return;
  handlerInstalled = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (err) {
    console.warn('[notificationService] setNotificationHandler failed:', err?.message || err);
  }
}

/**
 * Requests notification permission and (in dev/production builds only)
 * attempts remote push-token registration. NEVER throws.
 *
 * Returns { supported, granted, reason, token }.
 */
export async function registerForPushNotificationsAsync() {
  const env = getNotificationEnvironment();

  if (env === 'expo-go') {
    return { supported: false, granted: false, reason: EXPO_GO_REASON, message: EXPO_GO_MESSAGE, environment: env };
  }
  if (env === 'web') {
    return { supported: false, granted: false, reason: 'Push notifications are not enabled for web', environment: env };
  }

  const Notifications = getNotificationsModule();
  if (!Notifications) {
    return { supported: false, granted: false, reason: 'expo-notifications is unavailable', environment: env };
  }

  try {
    ensureHandler(Notifications);

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('[notificationService] Notification permission denied.');
      return { supported: true, granted: false, reason: 'Notification permission denied', environment: env };
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('eshield-alerts', {
        name: 'E-SHIELD Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Remote push token (development / production builds only). Failure here
    // (e.g. FCM not configured yet) must not affect local notifications.
    let token = null;
    try {
      const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
      if (projectId) {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      } else {
        console.warn('[notificationService] No EAS projectId configured; skipping remote push token.');
      }
    } catch (err) {
      console.warn('[notificationService] Remote push token unavailable:', err?.message || err);
    }

    return { supported: true, granted: true, token, environment: env };
  } catch (err) {
    console.warn('[notificationService] registration failed:', err?.message || err);
    return { supported: false, granted: false, reason: err?.message || 'Notification setup failed', environment: env };
  }
}

/**
 * Sends a local (device-only) notification. No-op in Expo Go / web.
 * Returns true if scheduled. Never throws.
 */
export async function sendLocalAlertNotification(alert, { simulated = false } = {}) {
  const Notifications = getNotificationsModule();
  if (!Notifications) return false;
  try {
    ensureHandler(Notifications);
    const title =
      (simulated ? '[DEMO] ' : '') +
      (alert.severity === 'CRITICAL' ? 'E-SHIELD CRITICAL ALERT' : 'E-SHIELD WARNING');
    const body = [alert.what, `Location: ${alert.where}`, `Load: ${alert.load}`].filter(Boolean).join('\n');
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { alert } }, trigger: null });
    return true;
  } catch (err) {
    console.warn('[notificationService] local notification failed:', err?.message || err);
    return false;
  }
}
