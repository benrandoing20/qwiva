import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lock, ShieldCheck } from 'lucide-react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '@/constants';
import { supabase } from '@/lib/supabase';
import { getPostAuthRoute } from '@/lib/routing';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  // Verify we have a recovery session on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        if (!session) {
          setError('This reset link has expired. Please request a new one.');
        }
        setSessionReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleResetPassword() {
    if (password.length < 8) {
      shake();
      errorHaptic();
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      shake();
      errorHaptic();
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      shake();
      errorHaptic();
      setError(updateError.message);
      return;
    }

    // Password updated. User is now signed in. Route to next step.
    const { data: { session } } = await supabase.auth.getSession();
    setLoading(false);

    if (!session?.user) {
      shake();
      errorHaptic();
      setError('Something went wrong. Please sign in.');
      router.replace('/onboarding/login');
      return;
    }

    successHaptic();
    const route = await getPostAuthRoute(session.user.id);
    router.replace(route as `/${string}`);
  }

  if (!sessionReady) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Verifying reset link...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error.includes('expired')) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.errorScreen}>
          <View style={styles.iconCircle}>
            <Lock size={32} color={Colors.danger} />
          </View>
          <Text style={styles.headline}>Link expired</Text>
          <Text style={styles.subtitle}>
            This password reset link has expired. Reset links are valid for 1 hour.
          </Text>
          <Button
            label="Request a new link"
            variant="navy"
            size="lg"
            onPress={() => {
              tapHaptic();
              router.replace('/onboarding/forgot-password');
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconCircle}>
            <ShieldCheck size={32} color={Colors.purple} />
          </View>
          <Text style={styles.eyebrow}>Almost there</Text>
          <Text style={styles.headline}>Set your new{'\n'}password.</Text>
          <Text style={styles.subtitle}>
            Choose a password you'll remember. We recommend at least 8 characters.
          </Text>

          <Animated.View style={[styles.fields, shakeStyle]}>
            <Input
              label="New password"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="next"
            />
            <Input
              label="Confirm password"
              placeholder="••••••••"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleResetPassword}
            />
          </Animated.View>

          {error !== '' && !error.includes('expired') && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Set new password"
            variant="navy"
            size="lg"
            loading={loading}
            onPress={() => { tapHaptic(); handleResetPassword(); }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgBase },
  flex: { flex: 1 },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textSecondary,
  },

  errorScreen: {
    flex: 1,
    paddingHorizontal: Spacing.s7,
    paddingTop: Spacing.s8,
    paddingBottom: Spacing.s8,
    gap: Spacing.s3,
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

  fields: { gap: Spacing.s4 },

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
});
