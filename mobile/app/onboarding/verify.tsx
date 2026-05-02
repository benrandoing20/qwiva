import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Stethoscope, Activity, SmilePlus, GraduationCap } from 'lucide-react-native';
import { Input } from '../../src/components/ui/Input';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { supabase } from '../../src/lib/supabase';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { tapHaptic, successHaptic, errorHaptic, selectionHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

type Cadre = 'Medical Practitioner' | 'Clinical Officer' | 'Dental Practitioner' | 'Intern';

type CadreConfig = {
  label: string;
  placeholder: string;
  pattern: RegExp;
  Icon: React.ComponentType<{ size: number; color: string }>;
};

const CADRE_CONFIG: Record<Cadre, CadreConfig> = {
  'Medical Practitioner': {
    label: 'KMPDC Registration No.',
    placeholder: 'e.g. A35671',
    pattern: /^[Aa]\d{4,5}$/,
    Icon: Stethoscope,
  },
  'Clinical Officer': {
    label: 'COC Licence Number',
    placeholder: 'e.g. Rd02177/25',
    pattern: /^[A-Za-z]{1,3}\d{3,6}\/\d{2}$/,
    Icon: Activity,
  },
  'Dental Practitioner': {
    label: 'KMPDC Registration No.',
    placeholder: 'e.g. B10234',
    pattern: /^[Bb]\d{4,5}$/,
    Icon: SmilePlus,
  },
  'Intern': {
    label: 'KMPDC Intern Licence No.',
    placeholder: 'e.g. 92000',
    pattern: /^\d{5}$/,
    Icon: GraduationCap,
  },
};

const CADRES: Cadre[] = ['Medical Practitioner', 'Clinical Officer', 'Dental Practitioner', 'Intern'];

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

export default function VerifyScreen() {
  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const [cadre, setCadre] = useState<Cadre | null>(null);
  const [regNumber, setRegNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const config = cadre ? CADRE_CONFIG[cadre] : null;
  const isValid = config !== null && config !== undefined && config.pattern.test(regNumber.trim());

  async function handleContinue() {
    if (!isValid || !cadre) return;
    setError('');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user.');
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ cadre, registration_number: regNumber.trim() })
        .eq('user_id', user.id);
      if (updateError) throw new Error(updateError.message);
      successHaptic();
      if (cadre === 'Intern') {
        router.push('/onboarding/rotation');
      } else {
        router.push({ pathname: '/onboarding/specialty', params: { cadre } });
      }
    } catch (e: unknown) {
      shake();
      errorHaptic();
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={() => { tapHaptic(); router.back(); }}>
            <ChevronLeft size={18} color={Colors.navy} />
          </TouchableOpacity>
          <ProgressBar step={3} total={4} />
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Step 3 of 4</Text>
          <Text style={styles.headline}>Tell us about{'\n'}your practice.</Text>
          <Text style={styles.subtitle}>
            This helps us tailor your CPD tracking and evidence feed to your clinical role.
          </Text>

          <Animated.View style={[shakeStyle, styles.formGroup]}>
          <View style={styles.cadreGrid}>
            {CADRES.map(c => {
              const { Icon } = CADRE_CONFIG[c];
              const selected = cadre === c;
              return (
                <TouchableOpacity
                  key={c}
                  style={[styles.cadreCard, selected && styles.cadreCardSelected]}
                  onPress={() => { selectionHaptic(); setCadre(c); setRegNumber(''); setError(''); }}
                  activeOpacity={0.75}
                >
                  <Icon size={22} color={selected ? Colors.lilac : Colors.textMuted} />
                  <Text style={[styles.cadreLabel, selected && styles.cadreLabelSelected]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {config && (
            <Input
              label={config.label}
              placeholder={config.placeholder}
              value={regNumber}
              onChangeText={v => { setRegNumber(v); setError(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
          )}
          </Animated.View>

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.continueBtn, (!isValid || loading) && styles.continueBtnDisabled]}
              onPress={() => { tapHaptic(); handleContinue(); }}
              activeOpacity={0.82}
              disabled={!isValid || loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.textInverse} />
                : <Text style={styles.continueBtnText}>Continue</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    fontSize: 32,
    color: Colors.navy,
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
  },

  formGroup: {
    gap: Spacing.s5,
  },
  cadreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s3,
  },
  cadreCard: {
    width: '47%',
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    borderWidth: 1.5,
    borderColor: Colors.borderDefault,
    paddingVertical: Spacing.s4,
    paddingHorizontal: Spacing.s4,
    alignItems: 'flex-start',
    gap: Spacing.s3,
    minHeight: 88,
  },
  cadreCardSelected: {
    borderColor: Colors.navy,
    backgroundColor: Colors.navy,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  cadreLabel: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySm,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  cadreLabelSelected: {
    color: Colors.textInverse,
    fontFamily: Fonts.sansBold,
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
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  continueBtnDisabled: { backgroundColor: Colors.purpleDisabled, shadowOpacity: 0, elevation: 0 },
  continueBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.textInverse,
  },
});
