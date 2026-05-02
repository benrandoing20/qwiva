import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  SafeAreaView as RNSafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronDown, Search } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { supabase } from '../../src/lib/supabase';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { tapHaptic, successHaptic, errorHaptic, selectionHaptic } from '@/lib/haptics';
import { useShake } from '@/hooks/useShake';

type Country = { name: string; flag: string; dial: string };

const COUNTRIES: Country[] = [
  { name: 'Kenya', flag: '🇰🇪', dial: '+254' },
  { name: 'Uganda', flag: '🇺🇬', dial: '+256' },
  { name: 'Tanzania', flag: '🇹🇿', dial: '+255' },
  { name: 'Rwanda', flag: '🇷🇼', dial: '+250' },
  { name: 'Ethiopia', flag: '🇪🇹', dial: '+251' },
  { name: 'South Sudan', flag: '🇸🇸', dial: '+211' },
  { name: 'Burundi', flag: '🇧🇮', dial: '+257' },
  { name: 'Somalia', flag: '🇸🇴', dial: '+252' },
  { name: 'Argentina', flag: '🇦🇷', dial: '+54' },
  { name: 'Australia', flag: '🇦🇺', dial: '+61' },
  { name: 'Austria', flag: '🇦🇹', dial: '+43' },
  { name: 'Belgium', flag: '🇧🇪', dial: '+32' },
  { name: 'Brazil', flag: '🇧🇷', dial: '+55' },
  { name: 'Cameroon', flag: '🇨🇲', dial: '+237' },
  { name: 'Canada', flag: '🇨🇦', dial: '+1' },
  { name: 'China', flag: '🇨🇳', dial: '+86' },
  { name: 'Denmark', flag: '🇩🇰', dial: '+45' },
  { name: 'Egypt', flag: '🇪🇬', dial: '+20' },
  { name: 'Finland', flag: '🇫🇮', dial: '+358' },
  { name: 'France', flag: '🇫🇷', dial: '+33' },
  { name: 'Germany', flag: '🇩🇪', dial: '+49' },
  { name: 'Ghana', flag: '🇬🇭', dial: '+233' },
  { name: 'India', flag: '🇮🇳', dial: '+91' },
  { name: 'Indonesia', flag: '🇮🇩', dial: '+62' },
  { name: 'Ireland', flag: '🇮🇪', dial: '+353' },
  { name: 'Italy', flag: '🇮🇹', dial: '+39' },
  { name: 'Japan', flag: '🇯🇵', dial: '+81' },
  { name: 'Malaysia', flag: '🇲🇾', dial: '+60' },
  { name: 'Mexico', flag: '🇲🇽', dial: '+52' },
  { name: 'Morocco', flag: '🇲🇦', dial: '+212' },
  { name: 'Netherlands', flag: '🇳🇱', dial: '+31' },
  { name: 'New Zealand', flag: '🇳🇿', dial: '+64' },
  { name: 'Nigeria', flag: '🇳🇬', dial: '+234' },
  { name: 'Norway', flag: '🇳🇴', dial: '+47' },
  { name: 'Pakistan', flag: '🇵🇰', dial: '+92' },
  { name: 'Philippines', flag: '🇵🇭', dial: '+63' },
  { name: 'Poland', flag: '🇵🇱', dial: '+48' },
  { name: 'Portugal', flag: '🇵🇹', dial: '+351' },
  { name: 'Saudi Arabia', flag: '🇸🇦', dial: '+966' },
  { name: 'Senegal', flag: '🇸🇳', dial: '+221' },
  { name: 'Singapore', flag: '🇸🇬', dial: '+65' },
  { name: 'South Africa', flag: '🇿🇦', dial: '+27' },
  { name: 'Spain', flag: '🇪🇸', dial: '+34' },
  { name: 'Sweden', flag: '🇸🇪', dial: '+46' },
  { name: 'Switzerland', flag: '🇨🇭', dial: '+41' },
  { name: 'UAE', flag: '🇦🇪', dial: '+971' },
  { name: 'United Kingdom', flag: '🇬🇧', dial: '+44' },
  { name: 'United States', flag: '🇺🇸', dial: '+1' },
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

export default function PhoneScreen() {
  const { shakeX, shake } = useShake();

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');

  const cleaned = phone.replace(/\s/g, '').replace(/^0/, '');
  const fullPhone = `${selectedCountry.dial}${cleaned}`;
  const isValid = cleaned.length >= 7;

  const filteredCountries = search.trim()
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.dial.includes(search)
      )
    : COUNTRIES;

  async function handleContinue() {
    if (cleaned.length < 7) {
      shake();
      errorHaptic();
      setError('Enter a valid phone number.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update({ phone: fullPhone })
          .eq('user_id', user.id);
        if (updateError) throw new Error(updateError.message);
      }
      successHaptic();
      router.push('/onboarding/verify');
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
          <ProgressBar step={2} total={4} />
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Step 2 of 4</Text>
          <Text style={styles.headline}>What's your{'\n'}phone number?</Text>
          <Text style={styles.subtitle}>
            We'll use this to reach you about your account.
          </Text>

          <Animated.View style={[styles.phoneRow, shakeStyle]}>
            <TouchableOpacity
              style={styles.countryCode}
              onPress={() => { tapHaptic(); setSearch(''); setShowPicker(true); }}
              activeOpacity={0.7}
            >
              <Text style={styles.flag}>{selectedCountry.flag}</Text>
              <Text style={styles.dialCode}>{selectedCountry.dial}</Text>
              <ChevronDown size={14} color={Colors.textMuted} />
            </TouchableOpacity>
            <TextInput
              style={styles.phoneInput}
              placeholder="712 548 901"
              placeholderTextColor={Colors.textMuted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoFocus
            />
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

      {/* Country picker modal */}
      <Modal
        visible={showPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPicker(false)}
      >
        <RNSafeAreaView style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Select country</Text>
            <TouchableOpacity onPress={() => { tapHaptic(); setShowPicker(false); }} hitSlop={8}>
              <Text style={styles.pickerClose}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Search size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search country or code"
              placeholderTextColor={Colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoFocus
              autoCapitalize="none"
            />
          </View>

          <FlatList
            data={filteredCountries}
            keyExtractor={item => item.dial + item.name}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.countryRow,
                  item.name === selectedCountry.name && styles.countryRowSelected,
                ]}
                onPress={() => {
                  selectionHaptic();
                  setSelectedCountry(item);
                  setShowPicker(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.countryFlag}>{item.flag}</Text>
                <Text style={styles.countryName}>{item.name}</Text>
                <Text style={styles.countryDial}>{item.dial}</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </RNSafeAreaView>
      </Modal>
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
  content: {
    paddingHorizontal: Spacing.s7,
    paddingTop: Spacing.s6,
    paddingBottom: 48,
    gap: Spacing.s5,
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

  phoneRow: {
    flexDirection: 'row',
    gap: Spacing.s2,
    alignItems: 'center',
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.button,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    paddingHorizontal: 12,
    paddingVertical: 15,
  },
  flag: { fontSize: 18 },
  dialCode: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.button,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    paddingVertical: 15,
    paddingHorizontal: 16,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
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

  // Picker modal
  pickerContainer: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s6,
    paddingVertical: Spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderDefault,
  },
  pickerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.h3,
    color: Colors.navy,
  },
  pickerClose: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.body,
    color: Colors.purple,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    margin: Spacing.s4,
    paddingHorizontal: Spacing.s4,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.button,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.s6,
    paddingVertical: Spacing.s4,
    gap: Spacing.s3,
  },
  countryRowSelected: {
    backgroundColor: Colors.bgNavyWash,
  },
  countryFlag: { fontSize: 22 },
  countryName: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  countryDial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySm,
    color: Colors.textMuted,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.borderDefault,
    marginLeft: Spacing.s6 + 22 + Spacing.s3,
  },
});
