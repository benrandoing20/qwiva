import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookOpen, AlertCircle, TrendingUp, ExternalLink } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';

const FEED_ITEMS = [
  {
    type: 'guideline',
    eyebrow: 'New guideline',
    title: 'Updated malaria treatment protocol — Kenya MoH 2024',
    body: 'AL remains first-line. Key change: extended artemether-lumefantrine course for high-risk patients.',
    tags: ['Infectious Disease', 'Protocol'],
    time: '2h ago',
  },
  {
    type: 'cme',
    eyebrow: 'CME · 1.5 CPD hrs',
    title: 'ACS Management in Low-Resource Settings',
    body: 'Evidence-based approach to STEMI/NSTEMI when cath lab access is limited.',
    tags: ['Cardiology', 'Emergency'],
    time: '5h ago',
  },
  {
    type: 'poll',
    eyebrow: 'Peer poll',
    title: 'What\'s your first-line for hypertensive emergency in pregnancy?',
    tags: ['Obs & Gynae'],
    time: '1d ago',
    poll: ['Hydralazine IV', 'Labetalol IV', 'Nifedipine oral', 'MgSO₄'],
  },
];

function FeedCard({ item }: { item: typeof FEED_ITEMS[0] }) {
  const isGuideline = item.type === 'guideline';
  const isCme = item.type === 'cme';

  return (
    <TouchableOpacity style={styles.feedCard} activeOpacity={0.75}>
      <View style={styles.feedCardTop}>
        <Text style={[styles.feedEyebrow, isCme && { color: Colors.info }]}>{item.eyebrow}</Text>
        <Text style={styles.feedTime}>{item.time}</Text>
      </View>
      <Text style={styles.feedTitle}>{item.title}</Text>
      {item.body && <Text style={styles.feedBody}>{item.body}</Text>}
      {item.poll && (
        <View style={styles.pollOptions}>
          {item.poll.map((opt, i) => (
            <TouchableOpacity key={i} style={styles.pollOption} activeOpacity={0.75}>
              <Text style={styles.pollOptionText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.feedTags}>
        {item.tags.map((t, i) => (
          <View key={i} style={styles.feedTag}>
            <Text style={styles.feedTagText}>{t}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

export default function FeedScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Evidence Feed</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {FEED_ITEMS.map((item, i) => (
          <FeedCard key={i} item={item} />
        ))}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  header: { paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s3 },
  screenTitle: { fontFamily: Fonts.display, fontSize: FontSizes.h1, color: Colors.navy },
  scrollContent: { padding: Spacing.s4, gap: Spacing.s3 },

  feedCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    gap: Spacing.s2,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  feedCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feedEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  feedTime: { fontFamily: Fonts.sans, fontSize: 11, color: Colors.textMuted },
  feedTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.navy,
    lineHeight: 21,
  },
  feedBody: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  pollOptions: { gap: 6 },
  pollOption: {
    padding: 10,
    borderRadius: Radii.button,
    borderWidth: 1.5,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgBase,
  },
  pollOptionText: { fontFamily: Fonts.sansMedium, fontSize: 13, color: Colors.textPrimary },
  feedTags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: Spacing.s1 },
  feedTag: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radii.chip,
    backgroundColor: Colors.bgNavyWash,
  },
  feedTagText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    color: Colors.info,
  },
});
