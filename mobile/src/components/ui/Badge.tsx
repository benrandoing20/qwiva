import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts, FontSizes, Radii } from '../../constants';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'oracle' | 'clinician' | 'healer' | 'xp' | 'streak';

interface Props {
  label: string;
  variant?: Variant;
}

const variantMap: Record<Variant, { bg: string; color: string }> = {
  success: { bg: Colors.successWash, color: Colors.success },
  warning: { bg: Colors.warningWash, color: Colors.warning },
  danger: { bg: Colors.dangerWash, color: Colors.danger },
  info: { bg: Colors.infoWash, color: Colors.info },
  oracle: { bg: '#EDE8F5', color: Colors.tierOracle },
  clinician: { bg: Colors.infoWash, color: Colors.tierClinician },
  healer: { bg: Colors.successWash, color: Colors.tierHealer },
  xp: { bg: '#FEF3C7', color: Colors.xpGold },
  streak: { bg: '#FFF0E8', color: Colors.streakFire },
};

export function Badge({ label, variant = 'info' }: Props) {
  const { bg, color } = variantMap[variant];
  return (
    <View style={[styles.base, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radii.chip,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
