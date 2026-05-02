import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Colors, Fonts, FontSizes } from '../../constants';

interface Props {
  children: React.ReactNode;
  color?: string;
}

export function Eyebrow({ children, color = Colors.purple }: Props) {
  return (
    <Text style={[styles.base, { color }]}>{children}</Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
