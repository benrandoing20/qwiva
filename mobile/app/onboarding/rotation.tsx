import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft, ArrowRight, Check,
  Activity, Scissors, Baby, HeartPulse, Brain, Zap, Syringe,
  Globe, Bone, Headphones, Eye, Sun, Search, Microscope, Users,
} from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '@/constants';
import { supabase } from '@/lib/supabase';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { tapHaptic, successHaptic, errorHaptic, selectionHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

type Rotation = {
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
};

const ROTATIONS: Rotation[] = [
  { label: 'Internal Medicine', Icon: Activity },
  { label: 'Surgery', Icon: Scissors },
  { label: 'Paediatrics', Icon: Baby },
  { label: 'Obs & Gynaecology', Icon: HeartPulse },
  { label: 'Psychiatry', Icon: Brain },
  { label: 'Emergency Medicine', Icon: Zap },
  { label: 'Anaesthesia', Icon: Syringe },
  { label: 'Community Health', Icon: Globe },
  { label: 'Orthopaedics', Icon: Bone },
  { label: 'ENT', Icon: Headphones },
  { label: 'Ophthalmology', Icon: Eye },
  { label: 'Dermatology', Icon: Sun },
  { label: 'Radiology', Icon: Search },
  { label: 'Pathology', Icon: Microscope },
  { label: 'Family Medicine', Icon: Users },
];

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.progressDot, i < step ? styles.progressActive : styles.progressInactive]}
        />
      ))}
    </View>
  );
}

const MAX_SELECTIONS = 3;

export default function RotationScreen() {
  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const maxReached = selected.length >= MAX_SELECTIONS;

  function toggleRotation(label: string) {
    setSelected(prev => {
      if (prev.includes(label)) return prev.filter(r => r !== label);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, label];
    });
  }

  async function handleContinue() {
    if (selected.length === 0) return;
    setError('');
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No authenticated user.');
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ current_rotation: selected })
        .eq('user_id', session.user.id);
      if (updateError) throw new Error(updateError.message);
      successHaptic();
      router.replace('/(tabs)/ask');
    } catch (e: unknown) {
      shake();
      errorHaptic();
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => { tapHaptic(); router.back(); }}>
          <ChevronLeft size={18} color={Colors.navy} />
        </TouchableOpacity>
        <ProgressBar step={4} total={4} />
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.eyebrow}>Step 4 of 4</Text>
        <Text style={styles.headline}>Which rotation{'\n'}are you in?</Text>
        <Text style={styles.subtitle}>
          Choose up to 3. We'll tailor your cases and evidence to what you're seeing right now.
        </Text>

        <Animated.View style={[styles.chipGrid, shakeStyle]}>
          {ROTATIONS.map(({ label, Icon }) => {
            const active = selected.includes(label);
            return (
              <TouchableOpacity
                key={label}
                style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                onPress={() => { selectionHaptic(); toggleRotation(label); setError(''); }}
                activeOpacity={0.8}
              >
                <Icon size={14} color={active ? Colors.pink : Colors.purple} />
                <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelInactive]}>
                  {label}
                </Text>
                {active && <Check size={14} color={Colors.pink} />}
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        <View style={styles.statusRow}>
          <View style={styles.dots}>
            {[0, 1, 2].map(i => (
              <View
                key={i}
                style={[styles.dot, i < selected.length ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>
          <Text style={styles.statusText}>
            {selected.length} of {MAX_SELECTIONS} selected{maxReached ? ' · max reached' : ''}
          </Text>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.continueBtn, selected.length === 0 && styles.continueBtnDisabled]}
            onPress={() => { tapHaptic(); handleContinue(); }}
            activeOpacity={0.82}
            disabled={selected.length === 0 || saving}
          >
            {saving
              ? <ActivityIndicator color={Colors.textInverse} />
              : <>
                  <Text style={styles.continueBtnText}>
                    Continue{selected.length > 0 ? ` with ${selected.length} selected` : ''}
                  </Text>
                  <ArrowRight size={18} color={Colors.textInverse} />
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRow: { flexDirection: 'row', gap: 4 },
  progressDot: { width: 24, height: 3, borderRadius: 2 },
  progressActive: { backgroundColor: Colors.purple },
  progressInactive: { backgroundColor: Colors.borderDefault },

  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.s7, gap: Spacing.s5, paddingBottom: 48 },

  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.navy,
    lineHeight: 36,
    letterSpacing: -0.4,
    marginTop: Spacing.s2,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginTop: Spacing.s2,
  },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: Colors.navy,
    borderColor: Colors.navy,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  chipInactive: {
    backgroundColor: Colors.bgElevated,
    borderColor: Colors.borderDefault,
  },
  chipLabel: { fontFamily: Fonts.sansBold, fontSize: 13.5 },
  chipLabelActive: { color: Colors.textInverse },
  chipLabelInactive: { color: Colors.textPrimary },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: Spacing.s2 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: Colors.pink },
  dotInactive: { backgroundColor: Colors.borderDefault },
  statusText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 12,
    color: Colors.purple,
    letterSpacing: 0.2,
  },

  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.danger,
  },

  actions: { gap: Spacing.s3, marginTop: Spacing.s2 },
  continueBtn: {
    backgroundColor: Colors.navy,
    borderRadius: Radii.card,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  continueBtnDisabled: { backgroundColor: Colors.purpleDisabled, shadowOpacity: 0, elevation: 0 },
  continueBtnText: { fontFamily: Fonts.sansBold, fontSize: 16, color: Colors.textInverse },
});
