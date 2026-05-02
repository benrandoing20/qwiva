import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { useTheme, type Theme } from '../../src/hooks/useTheme';
import { DURATION } from '../../src/lib/motion';
import { supabase } from '../../src/lib/supabase';
import { track } from '../../src/lib/analytics';
import { getPostAuthRoute } from '../../src/lib/routing';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

export default function LoginScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const containerOpacity = useSharedValue(0);
  const containerY = useSharedValue(24);

  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  React.useEffect(() => {
    track('onboarding_login_viewed');
    containerOpacity.value = withTiming(1, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
    containerY.value = withTiming(0, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ translateY: containerY.value }],
  }));

  async function handleSignIn() {
    if (!email.trim() || !password) {
      shake();
      errorHaptic();
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      shake();
      errorHaptic();
      setError(authError.message);
      setLoading(false);
      return;
    }
    track('onboarding_login_completed');
    successHaptic();
    const route = await getPostAuthRoute(data.user!.id);
    setLoading(false);
    router.replace(route as `/${string}`);
  }

  const canGoBack = router.canGoBack();

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.nav}>
          {canGoBack ? (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => {
                tapHaptic();
                router.back();
              }}
            >
              <ChevronLeft size={18} color={theme.text} />
            </TouchableOpacity>
          ) : (
            <View style={styles.navSpacer} />
          )}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={containerStyle}>
            <Text style={styles.eyebrow}>Welcome back</Text>
            <Text style={styles.headline}>Sign in to{'\n'}Qwiva.</Text>
            <Text style={styles.subtitle}>
              Your CPD record, cases, and evidence feed are waiting.
            </Text>
          </Animated.View>

          <Animated.View style={[styles.fields, shakeStyle]}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={[styles.input, emailFocused && styles.inputFocused]}
                placeholder="your@email.com"
                placeholderTextColor={theme.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View
                style={[
                  styles.passwordWrapper,
                  passwordFocused && styles.inputFocused,
                ]}
              >
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Your password"
                  placeholderTextColor={theme.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity
                  onPress={() => {
                    tapHaptic();
                    setShowPassword((v) => !v);
                  }}
                  style={styles.passwordToggle}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Text style={styles.passwordToggleText}>
                    {showPassword ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          <TouchableOpacity
            style={styles.forgotPasswordRow}
            onPress={() => {
              tapHaptic();
              router.push({
                pathname: '/onboarding/forgot-password',
                params: { email: email.trim() },
              });
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.forgotPasswordText}>Forgot password?</Text>
          </TouchableOpacity>

          {error !== '' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
            onPress={() => {
              tapHaptic();
              handleSignIn();
            }}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => {
              tapHaptic();
              router.replace('/onboarding/register');
            }}
          >
            <Text style={styles.switchText}>
              Don&apos;t have an account?{' '}
              <Text style={styles.switchLink}>Create one</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    flex: { flex: 1 },

    nav: {
      paddingHorizontal: Spacing.s5,
      paddingVertical: Spacing.s2,
      flexDirection: 'row',
      alignItems: 'center',
    },
    navSpacer: { width: 36, height: 36 },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },

    scrollContent: {
      padding: Spacing.s7,
      paddingBottom: Spacing.s8,
    },

    eyebrow: {
      fontFamily: Fonts.sansBold,
      fontSize: FontSizes.eyebrow,
      color: theme.accent,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    headline: {
      fontFamily: Fonts.sansBold,
      fontSize: FontSizes.h1,
      color: theme.text,
      letterSpacing: -0.5,
      lineHeight: 34,
      marginTop: Spacing.s2,
    },
    subtitle: {
      fontFamily: Fonts.sans,
      fontSize: FontSizes.body,
      color: theme.textSecondary,
      lineHeight: 22,
      marginTop: Spacing.s2,
      marginBottom: Spacing.s6,
    },

    fields: { gap: Spacing.s4 },
    field: { gap: 6 },
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
    passwordWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
    },
    passwordInput: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: theme.text,
    },
    passwordToggle: {
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    passwordToggleText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      color: theme.accent,
    },

    forgotPasswordRow: {
      alignSelf: 'flex-end',
      paddingVertical: Spacing.s2,
    },
    forgotPasswordText: {
      fontFamily: Fonts.sansMedium,
      fontSize: FontSizes.bodySm,
      color: theme.accent,
    },

    errorBox: {
      marginTop: Spacing.s4,
      backgroundColor: theme.dangerWash,
      borderRadius: Radii.button,
      padding: Spacing.s3,
      borderWidth: 1,
      borderColor: theme.danger,
    },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: FontSizes.bodySm,
      color: theme.danger,
      lineHeight: 18,
    },

    footer: {
      paddingHorizontal: Spacing.s7,
      paddingBottom: Spacing.s6,
      gap: Spacing.s3,
    },
    primaryBtn: {
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: {
      fontFamily: Fonts.sansBold,
      fontSize: 15,
      color: '#FFFFFF',
      letterSpacing: -0.1,
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
