import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';

const { width } = Dimensions.get('window');

export default function SplashScreen() {
  return (
    <SafeAreaView style={styles.container}>
      {/* Brand wash gradient */}
      <View style={styles.gradientBg} pointerEvents="none">
        <View style={styles.radialGlow} />
      </View>

      <View style={styles.center}>
        <Image
          source={require('../../assets/logo-mark.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.wordmark}>Qwiva</Text>
        <Text style={styles.tagline}>
          The smartest colleague{'\n'}you've ever had.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/onboarding/trial-ask')}
            activeOpacity={0.82}
          >
            <Text style={styles.primaryBtnText}>Ask a question first</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/onboarding/register')}
            activeOpacity={0.7}
          >
            <Text style={styles.ghostBtnText}>Already have an account?</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.footer}>
        Built for clinicians in Kenya &amp; across East Africa
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  gradientBg: {
    position: 'absolute',
    top: -40,
    left: -60,
    right: -60,
    height: 360,
    overflow: 'hidden',
  },
  radialGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 360,
    backgroundColor: 'rgba(217,136,186,0.12)',
    borderRadius: 9999,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  logo: {
    width: 84,
    height: 94,
    marginBottom: 18,
  },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 46,
    color: Colors.navy,
    letterSpacing: -1,
    lineHeight: 50,
  },
  tagline: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    width: '100%',
    marginTop: 36,
    gap: 4,
  },
  primaryBtn: {
    backgroundColor: Colors.navy,
    borderRadius: Radii.card,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  primaryBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.textInverse,
    letterSpacing: -0.2,
  },
  ghostBtnText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.navy,
    textAlign: 'center',
    paddingVertical: 10,
  },
  footer: {
    textAlign: 'center',
    fontSize: FontSizes.eyebrow,
    color: Colors.textMuted,
    paddingHorizontal: 24,
    paddingBottom: 16,
    letterSpacing: 0.2,
  },
});
