import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Fonts } from '@/constants';
import { selectionHaptic } from '@/lib/haptics';
import { getResponseMode } from '@/constants/responseModes';
import { ActiveModeCardProps } from './types';

export function ActiveModeCard({ modeId, onPress }: ActiveModeCardProps) {
  const mode = getResponseMode(modeId);
  const Icon = mode.icon;

  function handlePress() {
    selectionHaptic();
    onPress();
  }

  return (
    <Pressable onPress={handlePress} style={styles.cardWrapper}>
      <LinearGradient
        colors={['rgba(111,80,145,0.10)', 'rgba(217,136,186,0.08)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      />
      <View style={styles.content}>
        <View style={styles.iconBox}>
          <Icon size={18} color={Colors.textInverse} />
        </View>
        <View style={styles.textWrap}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{mode.label}</Text>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          </View>
          <Text style={styles.description}>{mode.description}</Text>
        </View>
        <ChevronRight size={16} color={Colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.purple,
    overflow: 'hidden',
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 4,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 14.5,
    color: Colors.navy,
    letterSpacing: -0.07,
  },
  activeBadge: {
    backgroundColor: Colors.bgElevated,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  activeBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.purple,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  description: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
});
