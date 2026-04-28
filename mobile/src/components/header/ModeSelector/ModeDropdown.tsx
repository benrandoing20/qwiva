import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Check } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Colors, Fonts } from '@/constants';
import { selectionHaptic } from '@/lib/haptics';
import { RESPONSE_MODES, ResponseModeId } from '@/constants/responseModes';
import { AdaptiveThinkingRow } from './AdaptiveThinkingRow';
import { ModeDropdownProps } from './types';

const DROPDOWN_W = 268;
const SCREEN_W = Dimensions.get('window').width;

export function ModeDropdown({
  selectedModeId,
  onSelectMode,
  adaptiveThinking,
  onToggleAdaptiveThinking,
  onDismiss,
}: ModeDropdownProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-8);
  const scale = useSharedValue(0.96);
  const scrimOpacity = useSharedValue(0);

  useEffect(() => {
    const easing = Easing.bezier(0.22, 1, 0.36, 1);
    opacity.value = withTiming(1, { duration: 240, easing });
    translateY.value = withTiming(0, { duration: 240, easing });
    scale.value = withTiming(1, { duration: 240, easing });
    scrimOpacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: -DROPDOWN_W / 2 },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity.value,
  }));

  function handleSelectMode(id: ResponseModeId) {
    selectionHaptic();
    onSelectMode(id);
    onDismiss();
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Scrim — tap to dismiss */}
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
          <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.scrimOverlay} />
        </Pressable>
      </Animated.View>

      {/* Dropdown card */}
      <Animated.View style={[styles.card, cardStyle]}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.cardOverlay} />
        <View style={styles.cardContent}>
          {/* Mode list */}
          <View style={styles.modeList}>
            {RESPONSE_MODES.map((m) => {
              const isSelected = m.id === selectedModeId;
              const Icon = m.icon;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => handleSelectMode(m.id)}
                  style={[
                    styles.modeRow,
                    isSelected && styles.modeRowSelected,
                  ]}
                >
                  <View style={styles.checkColumn}>
                    {isSelected && (
                      <Check size={14} color={Colors.purple} />
                    )}
                  </View>
                  <View style={styles.modeContent}>
                    <View style={styles.modeTitleRow}>
                      <Icon
                        size={14}
                        color={isSelected ? Colors.purple : Colors.textSecondary}
                      />
                      <Text style={styles.modeTitle}>{m.label}</Text>
                    </View>
                    <Text style={styles.modeDescription}>{m.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Adaptive thinking row */}
          <View style={styles.adaptiveSection}>
            <AdaptiveThinkingRow
              enabled={adaptiveThinking}
              onToggle={onToggleAdaptiveThinking}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  scrimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(250,250,250,0.55)',
  },
  card: {
    position: 'absolute',
    top: 116,
    left: SCREEN_W / 2,
    width: DROPDOWN_W,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,46,93,0.10)',
    overflow: 'hidden',
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.22,
    shadowRadius: 44,
    elevation: 16,
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  cardContent: {
    paddingTop: 6,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  modeList: {
    paddingBottom: 4,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 12,
  },
  modeRowSelected: {
    backgroundColor: 'rgba(111,80,145,0.06)',
  },
  checkColumn: {
    width: 16,
    paddingTop: 3,
    alignItems: 'center',
  },
  modeContent: {
    flex: 1,
    minWidth: 0,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modeTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 15,
    color: Colors.navy,
    letterSpacing: -0.07,
    lineHeight: 17,
  },
  modeDescription: {
    fontFamily: Fonts.sans,
    fontSize: 12.5,
    color: Colors.textSecondary,
    letterSpacing: -0.03,
    lineHeight: 17,
    marginTop: 3,
  },
  divider: {
    height: 1,
    marginHorizontal: 14,
    marginVertical: 4,
    backgroundColor: 'rgba(0,46,93,0.08)',
  },
  adaptiveSection: {
    paddingTop: 0,
  },
});
