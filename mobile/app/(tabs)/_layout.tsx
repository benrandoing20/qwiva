import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Fonts } from '@/constants';
import { useTheme } from '@/hooks/useTheme';
import { BlurView } from 'expo-blur';

interface TabLabelProps {
  label: string;
  focused: boolean;
}

function TabLabel({ label, focused }: TabLabelProps) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles.tabLabel,
        { color: focused ? theme.text : theme.textMuted },
        focused && styles.tabLabelActive,
      ]}
    >
      {label}
    </Text>
  );
}

export default function TabLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, { borderTopColor: theme.border }],
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView
              intensity={60}
              style={StyleSheet.absoluteFill}
              tint={theme.scheme === 'dark' ? 'dark' : 'light'}
            />
          ) : (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface, opacity: 0.95 }]}
            />
          ),
        tabBarShowLabel: true,
        tabBarItemStyle: styles.tabItem,
        tabBarIconStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen
        name="ask"
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Ask" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Discover" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="surveys"
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Surveys" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          tabBarLabel: ({ focused }) => <TabLabel label="Me" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    borderTopWidth: 1,
    height: 72,
    paddingBottom: 0,
    backgroundColor: 'transparent',
    elevation: 0,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 0,
  },
  tabLabel: {
    fontSize: 14,
    letterSpacing: -0.1,
    fontFamily: Fonts.sansMedium,
  },
  tabLabelActive: {
    fontFamily: Fonts.sansBold,
  },
});
