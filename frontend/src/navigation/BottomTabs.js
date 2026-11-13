import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme/colors';

import HomeScreen from '../screens/HomeScreen';
import WaveformScreen from '../screens/WaveformScreen';
import LoadsScreen from '../screens/LoadsScreen';
import AlertsScreen from '../screens/AlertsScreen';
import MoreScreen from '../screens/MoreScreen';

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: '⌂',
  Waveform: '∿',
  Loads: '▤',
  Alerts: '▲',
  More: '⋯',
};

function TabIcon({ routeName, color }) {
  return <Text style={{ fontSize: 18, color }}>{ICONS[routeName] || '•'}</Text>;
}

export default function BottomTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarActiveBackgroundColor: colors.accentBg,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color }) => <TabIcon routeName={route.name} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'HOME' }} />
      <Tab.Screen name="Waveform" component={WaveformScreen} options={{ tabBarLabel: 'WAVEFORM' }} />
      <Tab.Screen name="Loads" component={LoadsScreen} options={{ tabBarLabel: 'LOADS' }} />
      <Tab.Screen name="Alerts" component={AlertsScreen} options={{ tabBarLabel: 'ALERTS' }} />
      <Tab.Screen name="More" component={MoreScreen} options={{ tabBarLabel: 'MORE' }} />
    </Tab.Navigator>
  );
}
