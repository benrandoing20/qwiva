import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame, Star, TrendingUp } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';

const LEADERBOARD = [
  { rank: 1, name: 'Dr. Kamau N.', xp: 4820, specialty: 'Surgery' },
  { rank: 2, name: 'Dr. Wanjiku M.', xp: 4105, specialty: 'Paediatrics' },
  { rank: 3, name: 'Dr. Ochieng P.', xp: 3890, specialty: 'Internal Medicine' },
  { rank: 42, name: 'Dr. Amara Hassan', xp: 2840, specialty: 'Internal Medicine', isMe: true },
];

export default function PulseScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Pulse</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Weekly stats */}
        <View style={styles.weekCard}>
          <Text style={styles.weekTitle}>This week</Text>
          <View style={styles.weekStats}>
            <View style={styles.weekStat}>
              <Flame size={20} color={Colors.streakFire} />
              <Text style={styles.weekStatValue}>7</Text>
              <Text style={styles.weekStatLabel}>Day streak</Text>
            </View>
            <View style={styles.weekDivider} />
            <View style={styles.weekStat}>
              <Star size={20} color={Colors.xpGold} />
              <Text style={styles.weekStatValue}>340</Text>
              <Text style={styles.weekStatLabel}>XP earned</Text>
            </View>
            <View style={styles.weekDivider} />
            <View style={styles.weekStat}>
              <TrendingUp size={20} color={Colors.success} />
              <Text style={styles.weekStatValue}>12</Text>
              <Text style={styles.weekStatLabel}>Cases done</Text>
            </View>
          </View>
        </View>

        {/* Leaderboard */}
        <Text style={styles.sectionLabel}>Monthly leaderboard</Text>
        <View style={styles.card}>
          {LEADERBOARD.map((entry, i) => (
            <View key={i} style={[styles.leaderRow, entry.isMe && styles.leaderRowMe, i > 0 && { marginTop: 14 }]}>
              <Text style={[styles.rank, entry.rank <= 3 && { color: Colors.xpGold }]}>
                #{entry.rank}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.leaderName, entry.isMe && { color: Colors.navy }]}>{entry.name}</Text>
                <Text style={styles.leaderSpec}>{entry.specialty}</Text>
              </View>
              <Text style={styles.leaderXp}>{entry.xp.toLocaleString()} XP</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  header: { paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s3 },
  screenTitle: { fontFamily: Fonts.display, fontSize: FontSizes.h1, color: Colors.navy },
  scrollContent: { padding: Spacing.s4, gap: Spacing.s4 },

  weekCard: {
    backgroundColor: Colors.navy,
    borderRadius: Radii.hero,
    padding: 20,
    gap: Spacing.s4,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  weekTitle: { fontFamily: Fonts.sansBold, fontSize: 13, color: 'rgba(240,240,248,0.7)', letterSpacing: 0.2 },
  weekStats: { flexDirection: 'row', alignItems: 'center' },
  weekStat: { flex: 1, alignItems: 'center', gap: 4 },
  weekStatValue: { fontFamily: Fonts.sansBold, fontSize: 24, color: Colors.textInverse },
  weekStatLabel: { fontFamily: Fonts.sans, fontSize: 11, color: 'rgba(240,240,248,0.6)' },
  weekDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.12)' },

  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.purple,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingLeft: 4,
  },
  card: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 4 },
  leaderRowMe: {
    backgroundColor: Colors.infoWash,
    borderRadius: Radii.button,
    padding: 10,
    marginHorizontal: -6,
  },
  rank: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.textMuted, width: 32, textAlign: 'center' },
  leaderName: { fontFamily: Fonts.sansBold, fontSize: 14, color: Colors.textPrimary },
  leaderSpec: { fontFamily: Fonts.sans, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  leaderXp: { fontFamily: Fonts.sansBold, fontSize: 13, color: Colors.info },
});
