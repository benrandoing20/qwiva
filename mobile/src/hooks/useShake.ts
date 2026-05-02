import {
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

interface UseShakeReturn {
  shakeX: SharedValue<number>;
  shake: () => void;
}

export function useShake(): UseShakeReturn {
  const shakeX = useSharedValue(0);

  const shake = (): void => {
    shakeX.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8,  { duration: 50 }),
      withTiming(-8, { duration: 50 }),
      withTiming(8,  { duration: 50 }),
      withTiming(-6, { duration: 40 }),
      withTiming(6,  { duration: 40 }),
      withTiming(0,  { duration: 40 }),
    );
  };

  return { shakeX, shake };
}
