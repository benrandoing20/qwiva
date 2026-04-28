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
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ArrowRight, ShieldCheck } from 'lucide-react-native';
import { Input } from '../../src/components/ui/Input';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { supabase } from '../../src/lib/supabase';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';
import { signInWithGoogle } from '@/lib/auth';

const googleLogo = require('../../assets/google-logo.png');

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

export default function RegisterScreen() {
  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const isValid = firstName.trim().length > 0
    && lastName.trim().length > 0
    && email.trim().length > 0
    && password.trim().length > 0;

  async function handleGoogle() {
    setError('');
    setGoogleLoading(true);
    const { error: signInError, route } = await signInWithGoogle();
    setGoogleLoading(false);
    if (signInError) {
      shake();
      errorHaptic();
      setError(signInError);
      return;
    }
    if (route) {
      router.replace(route as `/${string}`);
    }
  }

  async function handleContinue() {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) {
      errorHaptic(); shake();
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
      // Session is only present when email confirmation is disabled.
      // When it exists, save names now. Otherwise they are saved after phone verification.
      if (data.session && data.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({ id: data.user.id, first_name: firstName.trim(), last_name: lastName.trim() });
        if (profileError) throw new Error(profileError.message);
      }
      successHaptic();
      router.push('/onboarding/phone');
    } catch (e: unknown) {
      errorHaptic(); shake();
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={() => { tapHaptic(); router.back(); }}>
            <ChevronLeft size={18} color={Colors.navy} />
          </TouchableOpacity>
          <ProgressBar step={1} total={4} />
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>Step 1 of 4</Text>
          <Text style={styles.headline}>Let's set up{'\n'}your clinical world.</Text>
          <Text style={styles.subtitle}>
            Your CPD hours, answers, and evidence feed adapt to the specialties you actually see.
          </Text>

          <Animated.View style={[styles.fields, shakeStyle]}>
            <TouchableOpacity
              style={styles.googleButton}
              onPress={() => { tapHaptic(); handleGoogle(); }}
              disabled={googleLoading || loading}
              activeOpacity={0.82}
            >
              {googleLoading ? (
                <ActivityIndicator color={Colors.textPrimary} />
              ) : (
                <>
                  <Image source={googleLogo} style={styles.googleLogo} resizeMode="contain" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.nameRow}>
              <Input
                label="First name"
                placeholder="Amara"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                returnKeyType="next"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="Last name"
                placeholder="Hassan"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                returnKeyType="next"
                containerStyle={{ flex: 1 }}
              />
            </View>
            <Input
              label="Email"
              placeholder="your@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />
            <Input
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
            />
          </Animated.View>

          {/* CPD value prop */}
          <View style={styles.valueProp}>
            <View style={styles.valuePropRow}>
              <ShieldCheck size={18} color={Colors.info} />
              <Text style={styles.valuePropTitle}>CPD-logged from day one</Text>
            </View>
            <Text style={styles.valuePropBody}>
              Every case, answer, and module counts toward KMPDC-recognised CPD hours. Export anytime.
            </Text>
          </View>

          <View style={styles.actions}>
            {!!error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity
              style={[styles.continueBtn, (!isValid || loading) && styles.continueBtnDisabled]}
              onPress={() => { tapHaptic(); handleContinue(); }}
              activeOpacity={0.82}
              disabled={!isValid || loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.textInverse} />
                : <>
                    <Text style={styles.continueBtnText}>Continue</Text>
                    <ArrowRight size={18} color={Colors.textInverse} />
                  </>
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
  scrollContent: { padding: Spacing.s7, gap: Spacing.s6, paddingBottom: 48 },

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
    marginTop: Spacing.s2,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginTop: Spacing.s2,
  },

  fields: { gap: Spacing.s4 },
  nameRow: { flexDirection: 'row', gap: Spacing.s3 },

  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s2,
    paddingVertical: 14,
    borderRadius: Radii.button,
    borderWidth: 1.5,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
  },
  googleLogo: {
    width: 18,
    height: 18,
  },
  googleButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    marginVertical: Spacing.s2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.borderDefault,
  },
  dividerText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySm,
    color: Colors.textMuted,
  },

  valueProp: {
    backgroundColor: 'rgba(238,243,249,0.6)',
    borderRadius: Radii.card,
    padding: Spacing.s4,
    borderWidth: 1,
    borderColor: 'rgba(226,226,236,0.5)',
    gap: Spacing.s2,
  },
  valuePropRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  valuePropTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    color: Colors.navy,
  },
  valuePropBody: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    color: Colors.textSecondary,
    lineHeight: 18,
  },

  actions: { gap: Spacing.s3, marginTop: Spacing.s2 },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.danger,
    textAlign: 'center',
  },
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
  continueBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
    color: Colors.textInverse,
  },
});
