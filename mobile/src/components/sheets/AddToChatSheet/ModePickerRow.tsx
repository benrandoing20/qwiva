import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors, Fonts } from '@/constants';
import { selectionHaptic } from '@/lib/haptics';
import { getResponseMode } from '@/constants/responseModes';
import { ModePickerRowProps } from './types';

export function ModePickerRow({ modeId, isSelected, onPress }: ModePickerRowProps) {
  const mode = getResponseMode(modeId);
  const Icon = mode.icon;

  function handlePress() {
    selectionHaptic();
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.row, isSelected ? styles.rowSelected : styles.rowUnselected]}
    >
      <View
        style={[
          styles.iconBox,
          isSelected ? styles.iconBoxSelected : styles.iconBoxUnselected,
        ]}
      >
        <Icon
          size={18}
          color={isSelected ? Colors.textInverse : Colors.textSecondary}
        />
      </View>
      <View style={styles.textWrap}>
        <Text
          style={[
            styles.title,
            { color: isSelected ? Colors.navy : Colors.textPrimary },
          ]}
        >
          {mode.label}
        </Text>
        <Text style={styles.description}>{mode.description}</Text>
      </View>
      <View
        style={[
          styles.indicator,
          isSelected ? styles.indicatorSelected : styles.indicatorUnselected,
        ]}
      >
        {isSelected && <Check size={13} color={Colors.textInverse} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
  },
  rowSelected: {
    backgroundColor: 'rgba(111,80,145,0.08)',
    borderWidth: 1.5,
    borderColor: Colors.purple,
  },
  rowUnselected: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: 'rgba(0,46,93,0.08)',
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconBoxSelected: {
    backgroundColor: Colors.purple,
  },
  iconBoxUnselected: {
    backgroundColor: 'rgba(0,46,93,0.06)',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 14.5,
    letterSpacing: -0.07,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  indicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  indicatorSelected: {
    backgroundColor: Colors.purple,
  },
  indicatorUnselected: {
    borderWidth: 1.5,
    borderColor: 'rgba(0,46,93,0.18)',
  },
});
