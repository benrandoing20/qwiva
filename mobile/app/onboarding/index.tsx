import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { tapHaptic } from '@/lib/haptics';

export default function LandingScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.container}>

        {/* Hero — flex:1 centres logo + wordmark + tagline vertically */}
        <View style={styles.hero}>
          <View style={styles.logoShadow}>
            <Image
              source={require('../../assets/logo-mark.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.wordmark}>qwiva</Text>
          <Text style={styles.tagline}>
            The smartest colleague{'\n'}you've ever had.
          </Text>
        </View>

        {/* CTAs */}
        <View style={styles.ctas}>
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.82}
            onPress={() => { tapHaptic(); router.push('/onboarding/register'); }}
          >
            <Text style={styles.primaryBtnText}>Create account</Text>
            <ArrowRight size={17} color={Colors.textInverse} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.82}
            onPress={() => { tapHaptic(); router.push('/onboarding/login'); }}
          >
            <Text style={styles.secondaryBtnText}>Log in</Text>
          </TouchableOpacity>
        </View>

        {/* Footer — lines flanking eyebrow text */}
        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>Built for clinicians by clinicians</Text>
          <View style={styles.footerLine} />
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  container: {
    flex: 1,
    paddingTop: Spacing.s10 + Spacing.s8,  // 72 — matches design paddingTop
  },

  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.s10,
  },
  logoShadow: {
    marginBottom: Spacing.s5,
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
  logo: {
    width: 88,
    height: 98,
  },
  wordmark: {
    fontFamily: Fonts.gilroySemiBold,
    fontSize: 44,
    color: Colors.navy,
    letterSpacing: -1,
    fontVariant: ['small-caps'],
  },
  tagline: {
    fontFamily: Fonts.gilroyLight,
    fontSize: 20,
    color: Colors.textSecondary,
    marginTop: Spacing.s4,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 27,
    letterSpacing: -0.2,
  },

  ctas: {
    paddingHorizontal: Spacing.s7,   // 28
    paddingBottom: Spacing.s2,
    gap: Spacing.s2,
  },
  primaryBtn: {
    backgroundColor: Colors.navy,
    borderRadius: Radii.card,
    paddingVertical: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s2,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    elevation: 8,
  },
  primaryBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.body,
    color: Colors.textInverse,
    letterSpacing: -0.1,
  },
  secondaryBtn: {
    borderRadius: Radii.card,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.borderDefault,
  },
  secondaryBtnText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.body,
    color: Colors.navy,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.s6,
    paddingBottom: Spacing.s8 + Spacing.s1,  // 36
    marginTop: Spacing.s2,
    gap: Spacing.s2,
  },
  footerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.borderDefault,
  },
  footerText: {
    fontFamily: Fonts.gilroyLight,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
