import { Stack } from 'expo-router';
import { Colors } from '@/constants';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: Colors.bgBase },
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    />
  );
}