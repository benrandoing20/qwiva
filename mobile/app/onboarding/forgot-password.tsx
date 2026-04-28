import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Mail, CheckCircle2 } from 'lucide-react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '@/constants';
import { supabase } from '@/lib/supabase';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

const RESET_REDIRECT_URL = 'qwiva://auth/reset-password';

export default function ForgotPasswordScreen() {
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(emailParam ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  async function handleSendReset() {
    if (!email.trim()) {
      shake();
      errorHaptic();
      setError('Please enter your email.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: RESET_REDIRECT_URL }
    );
    setLoading(false);
    if (resetError) {
      shake();
      errorHaptic();
      setError(resetError.message);
      return;
    }
    successHaptic();
    setSent(true);
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={() => { tapHaptic(); router.back(); }}>
            <ChevronLeft size={18} color={Colors.navy} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {sent ? (
            <View style={styles.confirmationContainer}>
              <View style={styles.iconCircle}>
                <CheckCircle2 size={36} color={Colors.purple} />
              </View>
              <Text style={styles.headline}>Check your email</Text>
              <Text style={styles.subtitle}>
                We sent a password reset link to{'\n'}
                <Text style={styles.emailHighlight}>{email}</Text>
              </Text>
              <Text style={styles.helpText}>
                Tap the link in your email to set a new password. The link expires in 1 hour.
              </Text>
              <Text style={styles.helpText}>
                Didn't get it? Check your spam folder, or try again.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.iconCircle}>
                <Mail size={32} color={Colors.purple} />
              </View>
              <Text style={styles.eyebrow}>Reset password</Text>
              <Text style={styles.headline}>Forgot your{'\n'}password?</Text>
              <Text style={styles.subtitle}>
                Enter the email associated with your Qwiva account, and we'll send you a link to reset it.
              </Text>

              <Animated.View style={[styles.fields, shakeStyle]}>
                <Input
                  label="Email"
                  placeholder="your@email.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  returnKeyType="done"
                  onSubmitEditing={handleSendReset}
                />
              </Animated.View>

              {error !== '' && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {!sent && (
          <View style={styles.footer}>
            <Button
              label="Send reset link"
              variant="navy"
              size="lg"
              loading={loading}
              onPress={() => { tapHaptic(); handleSendReset(); }}
            />
          </View>
        )}

        {sent && (
          <View style={styles.footer}>
            <Button
              label="Back to sign in"
              variant="navy"
              size="lg"
              onPress={() => { tapHaptic(); router.replace('/onboarding/login'); }}
            />
            <TouchableOpacity
              style={styles.resendRow}
              onPress={() => { tapHaptic(); setSent(false); }}
            >
              <Text style={styles.resendText}>
                Didn't receive it? <Text style={styles.resendLink}>Try again</Text>
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgBase },
  flex: { flex: 1 },

  nav: {
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: {
    padding: Spacing.s7,
    paddingBottom: Spacing.s8,
  },

  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(111, 80, 146, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s5,
  },

  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.h1,
    color: Colors.navy,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginTop: Spacing.s2,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginTop: Spacing.s2,
    marginBottom: Spacing.s6,
  },
  emailHighlight: {
    fontFamily: Fonts.sansBold,
    color: Colors.navy,
  },
  helpText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.textMuted,
    lineHeight: 20,
    marginTop: Spacing.s3,
  },

  fields: { gap: Spacing.s4 },

  confirmationContainer: {
    alignItems: 'flex-start',
  },

  errorBox: {
    marginTop: Spacing.s4,
    backgroundColor: Colors.dangerWash,
    borderRadius: Radii.button,
    padding: Spacing.s3,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.danger,
    lineHeight: 18,
  },

  footer: {
    paddingHorizontal: Spacing.s7,
    paddingBottom: Spacing.s6,
    gap: Spacing.s3,
  },
  resendRow: { alignItems: 'center', paddingVertical: Spacing.s2 },
  resendText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.textSecondary,
  },
  resendLink: {
    fontFamily: Fonts.sansBold,
    color: Colors.purple,
  },
});
