import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import {
  Folder,
  Briefcase,
  LayoutGrid,
  ChevronRight,
} from 'lucide-react-native';
import { Colors, Fonts } from '@/constants';
import { tapHaptic } from '@/lib/haptics';
import { SecondaryRowProps } from './types';

export function SecondaryRow({ iconName, label, value, onPress }: SecondaryRowProps) {
  const Icon =
    iconName === 'folder' ? Folder :
    iconName === 'briefcase' ? Briefcase :
    LayoutGrid;

  function handlePress() {
    tapHaptic();
    onPress();
  }

  return (
    <Pressable onPress={handlePress} style={styles.row}>
      <Icon size={18} color={Colors.textPrimary} />
      <Text style={styles.label}>{label}</Text>
      {value && <Text style={styles.value}>{value}</Text>}
      <ChevronRight size={16} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,46,93,0.10)',
  },
  label: {
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  value: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.textMuted,
  },
});
