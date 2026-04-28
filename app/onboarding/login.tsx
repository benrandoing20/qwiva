import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
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
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { DURATION } from '../../src/lib/motion';
import { supabase } from '../../src/lib/supabase';
import { track } from '../../src/lib/analytics';
import { getPostAuthRoute } from '../../src/lib/routing';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';
import { signInWithGoogle } from '@/lib/auth';

const googleLogo = require('../../assets/google-logo.png');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
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
                  <Text style={styles.googleButtonText}>Sign in with Google</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Input
              label="Email"
              placeholder="your@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="next"
            />
            <Input
              label="Password"
              placeholder="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />
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
          <Button
            label="Sign In"
            variant="navy"
            size="lg"
            loading={loading}
            onPress={() => { tapHaptic(); handleSignIn(); }}
          />
          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => { tapHaptic(); router.replace('/onboarding/register'); }}
          >
            <Text style={styles.switchText}>
              Don't have an account?{' '}
              <Text style={styles.switchLink}>Create one</Text>
            </Text>
          </TouchableOpacity>
        </View>
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

  forgotPasswordRow: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.s2,
  },
  forgotPasswordText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySm,
    color: Colors.purple,
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
  switchRow: { alignItems: 'center', paddingVertical: Spacing.s2 },
  switchText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.textSecondary,
  },
  switchLink: {
    fontFamily: Fonts.sansBold,
    color: Colors.purple,
  },
});
