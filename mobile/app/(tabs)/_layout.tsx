import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Sparkles, Newspaper, GraduationCap, BarChart3, User } from 'lucide-react-native';
import { Colors, Fonts } from '../../src/constants';
import { BlurView } from 'expo-blur';

function TabIcon({ Icon, label, focused }: { Icon: any; label: string; focused: boolean }) {
  return (
    <View style={styles.tabItem}>
      <Icon size={22} color={focused ? Colors.navy : Colors.textMuted} strokeWidth={focused ? 2 : 1.75} />
      <Text style={[styles.tabLabel, focused ? styles.tabLabelActive : styles.tabLabelInactive]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => (
          Platform.OS === 'ios' ? (
            <BlurView intensity={60} style={StyleSheet.absoluteFill} tint="light" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.tabBarBg]} />
          )
        ),
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="ask"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon Icon={Sparkles} label="Ask" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon Icon={Newspaper} label="Feed" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon Icon={GraduationCap} label="Learn" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="pulse"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon Icon={BarChart3} label="Pulse" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon Icon={User} label="Me" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226,226,236,0.6)',
    height: 72,
    paddingBottom: 0,
    backgroundColor: 'transparent',
    elevation: 0,
  },
  tabBarBg: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  tabItem: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.2,
    fontFamily: Fonts.sansMedium,
  },
  tabLabelActive: { color: Colors.navy, fontFamily: Fonts.sansBold },
  tabLabelInactive: { color: Colors.textMuted },
});
