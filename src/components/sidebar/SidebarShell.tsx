import React, { createContext, useCallback, useContext, useState } from 'react';
import { View, StyleSheet, Pressable, Dimensions } from 'react-native';
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
import { Sidebar } from './Sidebar';
import { SidebarContextValue, SidebarShellProps } from './types';

const { width: FRAME_W } = Dimensions.get('window');
const OPEN_X = Math.round(FRAME_W * 0.78);
const OPEN_RADIUS = 28;
const OPEN_SCALE = 0.94;
const VELOCITY_SNAP = 600;

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within SidebarShell');
  }
  return ctx;
}

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 180,
  mass: 0.9,
};

export function SidebarShell({ children }: SidebarShellProps) {
  const panelX = useSharedValue(0);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    panelX.value = withSpring(OPEN_X, SPRING_CONFIG);
    setIsOpen(true);
  }, [panelX]);

  const close = useCallback(() => {
    panelX.value = withSpring(0, SPRING_CONFIG);
    setIsOpen(false);
  }, [panelX]);

  const toggle = useCallback(() => {
    if (panelX.value > OPEN_X * 0.5) {
      close();
    } else {
      open();
    }
  }, [open, close, panelX]);

  function handleItemPress() {
    close();
  }

  const panGesture = Gesture.Pan()
    .onChange((e) => {
      const next = Math.max(0, Math.min(OPEN_X, panelX.value + e.changeX));
      panelX.value = next;
    })
    .onEnd((e) => {
      const v = e.velocityX;
      const halfway = OPEN_X * 0.5;
      let target: number;
      if (v > VELOCITY_SNAP) {
        target = OPEN_X;
      } else if (v < -VELOCITY_SNAP) {
        target = 0;
      } else {
        target = panelX.value > halfway ? OPEN_X : 0;
      }
      panelX.value = withSpring(target, SPRING_CONFIG);
      runOnJS(setIsOpen)(target > 0);
    });

  const panelOuterStyle = useAnimatedStyle(() => {
    const progress = panelX.value / OPEN_X;
    const scale = interpolate(
      progress,
      [0, 1],
      [1, OPEN_SCALE],
      Extrapolation.CLAMP
    );
    const shadowOpacity = interpolate(
      progress,
      [0, 0.05, 1],
      [0, 0.22, 0.22],
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { translateX: panelX.value },
        { scale },
      ],
      shadowOpacity,
    };
  });

  const panelInnerStyle = useAnimatedStyle(() => {
    const progress = panelX.value / OPEN_X;
    const leftRadius = interpolate(
      progress,
      [0, 1],
      [0, OPEN_RADIUS],
      Extrapolation.CLAMP
    );
    const rightRadius = interpolate(
      progress,
      [0, 0.05, 1],
      [0, 14, 14],
      Extrapolation.CLAMP
    );
    return {
      borderTopLeftRadius: leftRadius,
      borderBottomLeftRadius: leftRadius,
      borderTopRightRadius: rightRadius,
      borderBottomRightRadius: rightRadius,
    };
  });

  const ctxValue: SidebarContextValue = {
    open,
    close,
    toggle,
    isOpen,
  };

  return (
    <SidebarContext.Provider value={ctxValue}>
      <View style={styles.root}>
        {/* Layer 1: fixed sidebar (never moves) */}
        <View style={styles.sidebarLayer}>
          <Sidebar onItemPress={handleItemPress} />
        </View>

        {/* Layer 2: draggable panel — outer wraps shadow, inner clips radius */}
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.panelOuter, panelOuterStyle]}>
            <Animated.View style={[styles.panelInner, panelInnerStyle]}>
              {children}
              {isOpen && (
                <Pressable
                  style={styles.closeOverlay}
                  onPress={close}
                />
              )}
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>
    </SidebarContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgSidebar,
    overflow: 'hidden',
  },
  sidebarLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  panelOuter: {
    ...StyleSheet.absoluteFillObject,
    transformOrigin: 'left center',
    shadowColor: Colors.navy,
    shadowOffset: { width: -12, height: 0 },
    shadowRadius: 36,
    elevation: 8,
  },
  panelInner: {
    flex: 1,
    backgroundColor: Colors.bgBase,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  closeOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
