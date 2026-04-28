import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Camera, Image as ImageIcon, FileUp } from 'lucide-react-native';
import { Colors, Fonts } from '@/constants';
import { tapHaptic } from '@/lib/haptics';
import { AttachmentTileProps } from './types';

export function AttachmentTile({ iconName, label, onPress }: AttachmentTileProps) {
  const Icon = iconName === 'camera' ? Camera : iconName === 'image' ? ImageIcon : FileUp;

  function handlePress() {
    tapHaptic();
    onPress();
  }

  return (
    <Pressable onPress={handlePress} style={styles.tile}>
      <Icon size={22} color={Colors.textPrimary} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    color: Colors.textPrimary,
  },
});
