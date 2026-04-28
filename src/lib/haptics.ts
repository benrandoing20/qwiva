import * as Haptics from 'expo-haptics';

export const tapHaptic = (): Promise<void> =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export const successHaptic = (): Promise<void> =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

export const errorHaptic = (): Promise<void> =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

export const selectionHaptic = (): Promise<void> =>
  Haptics.selectionAsync();
