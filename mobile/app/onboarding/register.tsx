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
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ArrowRight, ShieldCheck } from 'lucide-react-native';
import { Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { useTheme, type Theme } from '../../src/hooks/useTheme';
import { supabase } from '../../src/lib/supabase';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

function ProgressBar({ step, total, theme }: { step: number; total: number; theme: Theme }) {
  const styles = makeStyles(theme);
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

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'words' | 'sentences';
  returnKeyType?: 'next' | 'done' | 'go';
  flex?: boolean;
  theme: Theme;
}

function ThemedField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'none',
  returnKeyType,
  flex,
  theme,
}: FieldProps) {
  const styles = makeStyles(theme);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, flex && styles.fieldFlex]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused]}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        returnKeyType={returnKeyType}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

export default function RegisterScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isValid = firstName.trim().length > 0
    && lastName.trim().length > 0
    && email.trim().length > 0
    && password.trim().length > 0;

  async function handleContinue() {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) {
      errorHaptic(); shake();
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
          },
        },
      });
      if (signUpError) throw signUpError;
      successHaptic();
      router.push('/onboarding/phone');
    } catch (e: unknown) {
      errorHaptic(); shake();
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    tapHaptic();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/onboarding/login');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <ChevronLeft size={18} color={theme.text} />
          </TouchableOpacity>
          <ProgressBar step={1} total={4} theme={theme} />
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Step 1 of 4</Text>
          <Text style={styles.headline}>Let&apos;s set up{'\n'}your clinical world.</Text>
          <Text style={styles.subtitle}>
            Your CPD hours, answers, and evidence feed adapt to the specialties you actually see.
          </Text>

          <Animated.View style={[styles.fields, shakeStyle]}>
            <View style={styles.nameRow}>
              <ThemedField
                label="First name"
                placeholder="Amara"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                returnKeyType="next"
                flex
                theme={theme}
              />
              <ThemedField
                label="Last name"
                placeholder="Hassan"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                returnKeyType="next"
                flex
                theme={theme}
              />
            </View>
            <ThemedField
              label="Email"
              placeholder="your@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
              theme={theme}
            />
            <ThemedField
              label="Password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="done"
              theme={theme}
            />
          </Animated.View>

          {/* CPD value prop */}
          <View style={styles.valueProp}>
            <View style={styles.valuePropRow}>
              <ShieldCheck size={18} color={theme.accent} />
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
              onPress={() => {
                tapHaptic();
                handleContinue();
              }}
              activeOpacity={0.82}
              disabled={!isValid || loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.continueBtnText}>Continue</Text>
                  <ArrowRight size={18} color="#FFFFFF" />
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => {
                tapHaptic();
                router.replace('/onboarding/login');
              }}
            >
              <Text style={styles.switchText}>
                Already have an account?{' '}
                <Text style={styles.switchLink}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
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
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressRow: { flexDirection: 'row', gap: 4 },
    progressDot: { width: 24, height: 3, borderRadius: 2 },
    progressActive: { backgroundColor: theme.accent },
    progressInactive: { backgroundColor: theme.border },

    scroll: { flex: 1 },
    scrollContent: { padding: Spacing.s7, gap: Spacing.s6, paddingBottom: 48 },

    eyebrow: {
      fontFamily: Fonts.sansBold,
      fontSize: FontSizes.eyebrow,
      color: theme.accent,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    headline: {
      fontFamily: Fonts.sansBold,
      fontSize: 32,
      color: theme.text,
      letterSpacing: -0.5,
      lineHeight: 38,
      marginTop: Spacing.s2,
    },
    subtitle: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 21,
      marginTop: Spacing.s2,
    },

    fields: { gap: Spacing.s4 },
    nameRow: { flexDirection: 'row', gap: Spacing.s3 },
    field: { gap: 6 },
    fieldFlex: { flex: 1 },
    fieldLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    input: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: theme.text,
    },
    inputFocused: {
      borderColor: theme.borderFocus,
    },

    valueProp: {
      backgroundColor: theme.surface,
      borderRadius: Radii.card,
      padding: Spacing.s4,
      borderWidth: 1,
      borderColor: theme.border,
      gap: Spacing.s2,
    },
    valuePropRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
    valuePropTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.text,
    },
    valuePropBody: {
      fontFamily: Fonts.sans,
      fontSize: 12.5,
      color: theme.textSecondary,
      lineHeight: 18,
    },

    actions: { gap: Spacing.s3, marginTop: Spacing.s2 },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: FontSizes.bodySm,
      color: theme.danger,
      textAlign: 'center',
    },
    continueBtn: {
      backgroundColor: theme.accent,
      borderRadius: Radii.card,
      paddingVertical: 18,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    continueBtnDisabled: { opacity: 0.4 },
    continueBtnText: {
      fontFamily: Fonts.sansBold,
      fontSize: 16,
      color: '#FFFFFF',
    },
    switchRow: { alignItems: 'center', paddingVertical: Spacing.s2 },
    switchText: {
      fontFamily: Fonts.sans,
      fontSize: FontSizes.bodySm,
      color: theme.textSecondary,
    },
    switchLink: {
      fontFamily: Fonts.sansBold,
      color: theme.accent,
    },
  });
}
