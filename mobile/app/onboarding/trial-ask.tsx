import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QwivaLogo } from '../../src/components/ui/QwivaLogo';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';

function SourcePill({ label }: { label: string }) {
  return (
    <View style={styles.sourcePill}>
      <Text style={styles.sourcePillText}>{label}</Text>
    </View>
  );
}

function SourceCard({ num, title, site }: { num: number; title: string; site: string }) {
  return (
    <View style={styles.sourceCard}>
      <View style={styles.sourceNumRow}>
        <View style={styles.sourceNum}>
          <Text style={styles.sourceNumText}>{num}</Text>
        </View>
        <Text style={styles.sourceSite} numberOfLines={1}>{site}</Text>
      </View>
      <Text style={styles.sourceTitle}>{title}</Text>
    </View>
  );
}

export default function TrialAskScreen() {
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.freeTag}>Free preview · 1 of 1</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* User message */}
        <View style={styles.userMsgRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userBubbleText}>
              First-line for uncomplicated falciparum malaria in a non-pregnant adult?
            </Text>
          </View>
        </View>

        {/* AI response */}
        <View style={styles.aiSection}>
          {/* AI header */}
          <View style={styles.aiHeader}>
            <QwivaLogo size={20} />
            <Text style={styles.aiName}>Qwiva</Text>
            <View style={{ flex: 1 }} />
            <SourcePill label="KEMRI" />
            <SourcePill label="WHO" />
          </View>

          {/* Answer */}
          <Text style={styles.answerText}>
            <Text style={styles.answerBold}>Artemether–lumefantrine (AL)</Text>
            <Text> — 6-dose regimen over 3 days, taken with fat for absorption. Kenya MoH first-line per the </Text>
            <Text style={styles.guidelinePill}>2023 guidelines¹</Text>
            <Text>. Alternative: dihydroartemisinin–piperaquine if AL unavailable².</Text>
            <Animated.Text style={[styles.cursor, { opacity: blink }]}> |</Animated.Text>
          </Text>

          {/* Sources */}
          <View style={styles.sourcesSection}>
            <Text style={styles.sourcesLabel}>2 SOURCES</Text>
            <View style={styles.sourceCards}>
              <SourceCard num={1} title="Kenya MoH National Malaria" site="guidelines.health.go.ke" />
              <SourceCard num={2} title="WHO Malaria Guidelines" site="who.int · Mar 2024" />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* CTA banner */}
      <View style={styles.ctaWrapper}>
        <View style={styles.ctaBanner}>
          <Text style={styles.ctaEyebrow}>Unlimited</Text>
          <Text style={styles.ctaHeadline}>Keep asking. Free for clinicians.</Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => router.push('/onboarding/register')}
            activeOpacity={0.9}
          >
            <Text style={styles.ctaBtnText}>Create free account</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  topBar: {
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s3,
    alignItems: 'flex-end',
  },
  freeTag: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.s5, gap: Spacing.s5 },

  userMsgRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: Colors.bgNavyWash,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    padding: 14,
    maxWidth: '82%',
  },
  userBubbleText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 21,
  },

  aiSection: { gap: Spacing.s3 },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2 + 2,
    marginBottom: Spacing.s1,
  },
  aiName: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  sourcePill: {
    backgroundColor: Colors.infoWash,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 5,
  },
  sourcePillText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.info,
    letterSpacing: 0.8,
  },

  answerText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    color: Colors.textPrimary,
    lineHeight: 25,
  },
  answerBold: {
    fontFamily: Fonts.sansBold,
    color: Colors.navy,
  },
  guidelinePill: {
    backgroundColor: Colors.infoWash,
    color: Colors.info,
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  cursor: {
    color: Colors.purple,
    fontFamily: Fonts.sansBold,
  },

  sourcesSection: { marginTop: Spacing.s4, paddingTop: Spacing.s4, borderTopWidth: 1, borderTopColor: Colors.borderDefault, gap: Spacing.s3 },
  sourcesLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
  },
  sourceCards: { flexDirection: 'row', gap: Spacing.s2 },
  sourceCard: {
    flex: 1,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.button,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    gap: 4,
  },
  sourceNumRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceNum: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: Colors.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceNumText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.textInverse,
    fontWeight: '700',
  },
  sourceSite: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1,
  },
  sourceTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    color: Colors.textPrimary,
    lineHeight: 15,
  },

  ctaWrapper: { padding: Spacing.s5, paddingBottom: Spacing.s4 },
  ctaBanner: {
    borderRadius: Radii.hero,
    padding: 20,
    backgroundColor: Colors.navy,
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
    gap: Spacing.s2,
  },
  ctaEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.pink,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  ctaHeadline: {
    fontFamily: Fonts.displayMedium,
    fontSize: 18,
    color: Colors.textInverse,
    lineHeight: 24,
  },
  ctaBtn: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.button,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: Spacing.s2,
  },
  ctaBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: Colors.navy,
  },
});
