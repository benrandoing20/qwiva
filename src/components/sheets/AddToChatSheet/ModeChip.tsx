import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Colors, Fonts } from '@/constants';
import { selectionHaptic } from '@/lib/haptics';
import { getResponseMode } from '@/constants/responseModes';
import { ModeChipProps } from './types';

export function ModeChip({ modeId, onPress }: ModeChipProps) {
  const mode = getResponseMode(modeId);
  const Icon = mode.icon;

  function handlePress() {
    selectionHaptic();
    onPress();
  }

  return (
    <Pressable onPress={handlePress} style={styles.chip}>
      <Icon size={14} color={Colors.textSecondary} />
      <Text style={styles.label}>{mode.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: 'rgba(0,46,93,0.08)',
    borderRadius: 100,
    flexShrink: 0,
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    color: Colors.textPrimary,
    letterSpacing: -0.07,
  },
});
