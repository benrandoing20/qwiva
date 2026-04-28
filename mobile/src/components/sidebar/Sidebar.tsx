import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  MessageSquare,
  Folder,
  BookOpen,
} from 'lucide-react-native';
import { Colors, Fonts } from '@/constants';
import { tapHaptic } from '@/lib/haptics';
import { SidebarRecent } from './types';

const { width: SCREEN_W } = Dimensions.get('window');
const SIDEBAR_W = Math.round(SCREEN_W * 0.78);

interface SidebarProps {
  onItemPress: () => void;
}

const STARRED_ITEMS: string[] = [
  'Falciparum first-line, non-pregnant adult',
  'Sepsis bundle — 1h goals',
  'Childhood asthma · step-up',
  'Pre-eclampsia thresholds',
];

const RECENT_ITEMS: SidebarRecent[] = [
  { id: 'r1', label: 'AKI staging — KDIGO', timestamp: 'Today' },
  { id: 'r2', label: 'Antenatal Hb cutoff Kenya MoH', timestamp: 'Yesterday' },
  { id: 'r3', label: 'Snake-bite ASV dosing', timestamp: 'Mon' },
  { id: 'r4', label: 'Beta-blocker contraindications', timestamp: 'Sun' },
  { id: 'r5', label: 'IV fluid maintenance — paeds', timestamp: 'Sat' },
];

export function Sidebar({ onItemPress }: SidebarProps) {
  function handleChatsPress() {
    tapHaptic();
    onItemPress();
    // TODO Sprint 2: navigate to full-screen chats history view.
  }

  function handleCasesPress() {
    tapHaptic();
    onItemPress();
    // TODO Sprint 2: navigate to Cases route.
  }

  function handleCpdPress() {
    tapHaptic();
    onItemPress();
    // TODO Sprint 2: navigate to CPD library route.
  }

  function handleSearchPress() {
    tapHaptic();
    // TODO v1.1: wire sidebar chat search.
  }

  function handleStarredPress() {
    tapHaptic();
    onItemPress();
    // TODO Sprint 2: load starred chat.
  }

  function handleRecentPress() {
    tapHaptic();
    onItemPress();
    // TODO Sprint 2: load recent chat.
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — wordmark + search row */}
        <View style={styles.header}>
          <Text style={styles.wordmark}>qwiva</Text>
          <View style={styles.searchRow}>
            <TouchableOpacity
              style={styles.searchField}
              onPress={handleSearchPress}
              activeOpacity={0.7}
            >
              <Search size={15} color={Colors.textSecondary} />
              <Text style={styles.searchPlaceholder}>Search chats</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Primary nav */}
        <View style={styles.navSection}>
          <TouchableOpacity
            style={[styles.navItem, styles.navItemActive]}
            onPress={handleChatsPress}
            activeOpacity={0.7}
          >
            <MessageSquare size={18} color={Colors.purple} />
            <Text style={[styles.navLabel, styles.navLabelActive]}>Chats</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={handleCasesPress}
            activeOpacity={0.7}
          >
            <Folder size={18} color={Colors.textSecondary} />
            <Text style={styles.navLabel}>Cases</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={handleCpdPress}
            activeOpacity={0.7}
          >
            <BookOpen size={18} color={Colors.textSecondary} />
            <Text style={styles.navLabel}>CPD library</Text>
          </TouchableOpacity>
        </View>

        {/* Starred */}
        <View style={styles.sectionLabelWrap}>
          <Text style={styles.sectionLabel}>Starred</Text>
        </View>
        <View style={styles.itemList}>
          {STARRED_ITEMS.map((label, i) => (
            <TouchableOpacity
              key={`starred-${i}`}
              style={styles.simpleItem}
              onPress={handleStarredPress}
              activeOpacity={0.7}
            >
              <Text style={styles.simpleItemText} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Recents */}
        <View style={styles.sectionLabelWrap}>
          <Text style={styles.sectionLabel}>Recents</Text>
        </View>
        <View style={styles.itemList}>
          {RECENT_ITEMS.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.recentItem}
              onPress={handleRecentPress}
              activeOpacity={0.7}
            >
              <Text style={styles.recentLabel} numberOfLines={1}>
                {r.label}
              </Text>
              <Text style={styles.recentTimestamp}>{r.timestamp}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    width: SIDEBAR_W,
    flex: 1,
    backgroundColor: Colors.bgSidebar,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  // Header
  header: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 14,
  },
  wordmark: {
    fontFamily: Fonts.gilroySemiBold,
    fontSize: 28,
    color: Colors.navy,
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: 14,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchField: {
    flex: 1,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,46,93,0.05)',
    borderRadius: 100,
  },
  searchPlaceholder: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.textMuted,
    letterSpacing: -0.07,
  },
  // Primary nav
  navSection: {
    paddingHorizontal: 12,
    gap: 2,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  navItemActive: {
    backgroundColor: 'rgba(111,80,145,0.10)',
  },
  navLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    color: Colors.textPrimary,
    letterSpacing: -0.07,
  },
  navLabelActive: {
    fontFamily: Fonts.sansBold,
    color: Colors.navy,
  },

  // Section labels
  sectionLabelWrap: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },

  // Items
  itemList: {
    paddingHorizontal: 12,
  },
  simpleItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  simpleItemText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.textPrimary,
    letterSpacing: -0.07,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  recentLabel: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.textPrimary,
    letterSpacing: -0.07,
  },
  recentTimestamp: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    color: Colors.textMuted,
    flexShrink: 0,
  },
});
