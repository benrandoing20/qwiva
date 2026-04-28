import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Brain, Check } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { Colors, Fonts } from '@/constants';
import { selectionHaptic } from '@/lib/haptics';
import { AdaptiveThinkingRowProps } from './types';

export function AdaptiveThinkingRow({ enabled, onToggle }: AdaptiveThinkingRowProps) {
  const progress = useSharedValue(enabled ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(enabled ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, [enabled]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['#D7D7E2', Colors.purple]
    ),
  }));

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 14 }],
  }));

  function handlePress() {
    selectionHaptic();
    onToggle();
  }

  return (
    <Pressable onPress={handlePress} style={styles.row}>
      <View style={styles.checkColumn}>
        {enabled && <Check size={14} color={Colors.purple} />}
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Brain size={14} color={enabled ? Colors.purple : Colors.textSecondary} />
          <Text style={styles.title}>Adaptive thinking</Text>
        </View>
        <Text style={styles.description}>Slows down for complex cases</Text>
      </View>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.dot, dotStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 12,
  },
  checkColumn: {
    width: 16,
    paddingTop: 3,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.navy,
    letterSpacing: -0.07,
    lineHeight: 17,
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    color: Colors.textSecondary,
    letterSpacing: -0.03,
    lineHeight: 17,
    marginTop: 3,
  },
  track: {
    width: 36,
    height: 22,
    borderRadius: 100,
    padding: 2,
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
