import React, { useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Pressable, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Colors } from '@/constants';
import {
  SheetContainerProps,
  SheetContainerHandle,
  SheetSnapState,
  SheetSnapPoint,
} from './types';

const { height: SCREEN_H } = Dimensions.get('window');

const DEFAULT_SNAP_POINTS: SheetSnapPoint[] = [
  { id: 'collapsed', heightFraction: 0.62 },
  { id: 'expanded', heightFraction: 0.92 },
];

const SPRING_CONFIG = {
  damping: 22,
  stiffness: 200,
  mass: 1,
};

const DISMISS_VELOCITY = 800;
const EXPAND_VELOCITY = -600;

function snapPointToY(snapPoint: SheetSnapPoint): number {
  return SCREEN_H * (1 - snapPoint.heightFraction);
}

export const SheetContainer = forwardRef<
  SheetContainerHandle,
  SheetContainerProps
>(function SheetContainer(
  {
    visible,
    initialSnapState = 'collapsed',
    snapPoints = DEFAULT_SNAP_POINTS,
    onDismiss,
    onSnapStateChange,
    children,
    forceSnapState,
  },
  ref
) {
  const collapsedY = snapPointToY(
    snapPoints.find((s) => s.id === 'collapsed') ?? DEFAULT_SNAP_POINTS[0]
  );
  const expandedY = snapPointToY(
    snapPoints.find((s) => s.id === 'expanded') ?? DEFAULT_SNAP_POINTS[1]
  );

  const translateY = useSharedValue(SCREEN_H);
  const gestureStartSnapState = useSharedValue<SheetSnapState>('collapsed');
  const [snapState, setSnapState] = useState<SheetSnapState>(initialSnapState);
  const [mounted, setMounted] = useState(false);

  // Mount animation
  useEffect(() => {
    if (visible && !mounted) {
      setMounted(true);
      const targetY =
        initialSnapState === 'expanded' ? expandedY : collapsedY;
      translateY.value = withSpring(targetY, SPRING_CONFIG);
    }
  }, [visible]);

  // Dismiss animation
  useEffect(() => {
    if (!visible && mounted) {
      translateY.value = withSpring(
        SCREEN_H,
        SPRING_CONFIG,
        (finished) => {
          if (finished) {
            runOnJS(setMounted)(false);
          }
        }
      );
    }
  }, [visible]);

  // Forced snap state (e.g., from parent: switch from collapsed to expanded)
  useEffect(() => {
    if (forceSnapState && forceSnapState !== snapState && mounted) {
      const targetY = forceSnapState === 'expanded' ? expandedY : collapsedY;
      translateY.value = withSpring(targetY, SPRING_CONFIG);
      setSnapState(forceSnapState);
      onSnapStateChange?.(forceSnapState);
    }
  }, [forceSnapState]);

  const animateToSnap = (target: SheetSnapState) => {
    const targetY = target === 'expanded' ? expandedY : collapsedY;
    translateY.value = withSpring(targetY, SPRING_CONFIG);
    setSnapState(target);
    onSnapStateChange?.(target);
  };

  useImperativeHandle(ref, () => ({
    collapse: () => animateToSnap('collapsed'),
    expand: () => animateToSnap('expanded'),
    dismiss: onDismiss,
    getCurrentSnapState: () => snapState,
  }));

  const panGesture = Gesture.Pan()
    .onStart(() => {
      gestureStartSnapState.value = snapState;
    })
    .onChange((e) => {
      const next = Math.max(expandedY - 50, translateY.value + e.changeY);
      translateY.value = next;
    })
    .onEnd((e) => {
      const v = e.velocityY;
      const currentY = translateY.value;
      const startedFrom = gestureStartSnapState.value;

      // Dismissal is only permitted when the gesture started from
      // the collapsed state. From expanded, downward swipes always
      // gate at collapsed first (even with high velocity).
      const canDismiss = startedFrom === 'collapsed';
      const dismissThreshold = collapsedY + (SCREEN_H - collapsedY) * 0.4;
      const wantsDismiss =
        canDismiss && (v > DISMISS_VELOCITY || currentY > dismissThreshold);

      if (wantsDismiss) {
        translateY.value = withSpring(SCREEN_H, SPRING_CONFIG);
        runOnJS(onDismiss)();
        return;
      }

      // Upward velocity → expanded (always allowed)
      if (v < EXPAND_VELOCITY) {
        translateY.value = withSpring(expandedY, SPRING_CONFIG);
        runOnJS(setSnapState)('expanded');
        if (onSnapStateChange) runOnJS(onSnapStateChange)('expanded');
        return;
      }

      // Strong downward velocity from expanded → collapsed (the gate).
      // Without this, only position determines target, and a fast
      // swipe from expanded that doesn't quite reach collapsed by
      // position would snap back to expanded — wrong feel.
      if (startedFrom === 'expanded' && v > DISMISS_VELOCITY * 0.5) {
        translateY.value = withSpring(collapsedY, SPRING_CONFIG);
        runOnJS(setSnapState)('collapsed');
        if (onSnapStateChange) runOnJS(onSnapStateChange)('collapsed');
        return;
      }

      // Default: snap to nearest by position
      const distToExpanded = Math.abs(currentY - expandedY);
      const distToCollapsed = Math.abs(currentY - collapsedY);
      const target: SheetSnapState =
        distToExpanded < distToCollapsed ? 'expanded' : 'collapsed';
      const targetY = target === 'expanded' ? expandedY : collapsedY;
      translateY.value = withSpring(targetY, SPRING_CONFIG);
      runOnJS(setSnapState)(target);
      if (onSnapStateChange) runOnJS(onSnapStateChange)(target);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateY.value,
      [SCREEN_H, collapsedY],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  function handleBackdropPress() {
    if (snapState === 'expanded') {
      animateToSnap('collapsed');
    } else {
      onDismiss();
    }
  }

  if (!mounted && !visible) return null;

  return (
    <View style={styles.root} pointerEvents={mounted ? 'auto' : 'none'}>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropPress}>
          <BlurView intensity={10} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.backdropOverlay} />
        </Pressable>
      </Animated.View>

      {/* Sheet */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.sheet, sheetStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,22,30,0.32)',
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN_H,
    backgroundColor: Colors.bgBase,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: -16 },
    shadowOpacity: 0.2,
    shadowRadius: 40,
    elevation: 16,
  },
});
