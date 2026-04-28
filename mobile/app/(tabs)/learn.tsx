import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Play, Lock, CheckCircle2, Clock } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';

const MODULES = [
  {
    id: 1,
    title: 'Malaria Management in East Africa',
    cases: 8,
    done: 6,
    cpd: 2.0,
    locked: false,
    specialty: 'Infectious Disease',
  },
  {
    id: 2,
    title: 'ACS: From Presentation to PCI',
    cases: 10,
    done: 0,
    cpd: 2.5,
    locked: false,
    specialty: 'Cardiology',
  },
  {
    id: 3,
    title: 'Paediatric Fever Protocols',
    cases: 6,
    done: 6,
    cpd: 1.5,
    locked: false,
    specialty: 'Paediatrics',
  },
  {
    id: 4,
    title: 'Pre-eclampsia & Hypertension',
    cases: 8,
    done: 0,
    cpd: 2.0,
    locked: true,
    specialty: 'Obs & Gynae',
  },
];

function ModuleCard({ mod }: { mod: typeof MODULES[0] }) {
  const progress = mod.cases > 0 ? mod.done / mod.cases : 0;
  const complete = mod.done === mod.cases;

  return (
    <TouchableOpacity
      style={[styles.moduleCard, mod.locked && styles.moduleCardLocked]}
      activeOpacity={0.75}
    >
      <View style={styles.moduleTop}>
        <View style={styles.moduleIconWrap}>
          {mod.locked ? (
            <Lock size={20} color={Colors.textMuted} />
          ) : complete ? (
            <CheckCircle2 size={20} color={Colors.success} />
          ) : (
            <Play size={20} color={Colors.purple} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.moduleSpecialty}>{mod.specialty}</Text>
          <Text style={[styles.moduleTitle, mod.locked && { color: Colors.textMuted }]}>
            {mod.title}
          </Text>
        </View>
      </View>

      {!mod.locked && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }, complete && styles.progressComplete]} />
        </View>
      )}

      <View style={styles.moduleMeta}>
        <Text style={styles.moduleMetaText}>{mod.cases} cases</Text>
        <View style={styles.metaDot} />
        <Clock size={11} color={Colors.textMuted} />
        <Text style={styles.moduleMetaText}>{mod.cpd} CPD hrs</Text>
        {!mod.locked && (
          <>
            <View style={styles.metaDot} />
            <Text style={[styles.moduleMetaText, complete && { color: Colors.success }]}>
              {mod.done}/{mod.cases} done
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function LearnScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Learn</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Your modules</Text>
        {MODULES.map(mod => (
          <ModuleCard key={mod.id} mod={mod} />
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

  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.purple,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingLeft: 4,
    marginBottom: Spacing.s1,
  },

  moduleCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    gap: Spacing.s3,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  moduleCardLocked: { opacity: 0.6 },
  moduleTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  moduleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(111,80,145,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  moduleSpecialty: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.purple,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  moduleTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.navy,
    lineHeight: 20,
  },

  progressTrack: {
    height: 4,
    backgroundColor: Colors.bgSurface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.purple,
    borderRadius: 2,
  },
  progressComplete: { backgroundColor: Colors.success },

  moduleMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moduleMetaText: { fontFamily: Fonts.sans, fontSize: 12, color: Colors.textMuted },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.textMuted },
});
