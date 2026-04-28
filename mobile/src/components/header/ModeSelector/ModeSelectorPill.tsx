import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Colors, Fonts } from '@/constants';
import { tapHaptic } from '@/lib/haptics';
import { getResponseMode } from '@/constants/responseModes';
import { ModeSelectorPillProps } from './types';

export function ModeSelectorPill({ modeId, isOpen, onPress }: ModeSelectorPillProps) {
  const rotation = useSharedValue(0);
  const mode = getResponseMode(modeId);
  const Icon = mode.icon;

  useEffect(() => {
    rotation.value = withTiming(isOpen ? 180 : 0, {
      duration: 240,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [isOpen]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  function handlePress() {
    tapHaptic();
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.pill,
        isOpen ? styles.pillOpen : styles.pillClosed,
      ]}
    >
      <View style={styles.iconBox}>
        <Icon size={12} color={Colors.purple} />
      </View>
      <Text style={styles.label}>{mode.label}</Text>
      <Animated.View style={chevronStyle}>
        <ChevronDown size={14} color={Colors.textSecondary} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  pillClosed: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  pillOpen: {
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },
  iconBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(111,80,145,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: 13.5,
    color: Colors.textPrimary,
    letterSpacing: -0.07,
  },
});
