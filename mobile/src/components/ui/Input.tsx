import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Radii, Spacing } from '../../constants';
import { tapHaptic } from '@/lib/haptics';

interface Props extends TextInputProps {
  label?: string;
  hint?: string;
  containerStyle?: ViewStyle;
  mono?: boolean;
}

export function Input({ label, hint, containerStyle, mono, style, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isPasswordField = props.secureTextEntry === true;
  const shouldMask = isPasswordField && !showPassword;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputWrapper}>
        <TextInput
          style={[
            styles.input,
            mono && styles.monoInput,
            focused && styles.focused,
            isPasswordField && styles.inputWithIcon,
            style,
          ]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={Colors.textMuted}
          {...props}
          secureTextEntry={shouldMask}
        />
        {isPasswordField && (
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => { tapHaptic(); setShowPassword(!showPassword); }}
            activeOpacity={0.7}
            hitSlop={8}
          >
            {showPassword ? (
              <EyeOff size={20} color={Colors.textMuted} />
            ) : (
              <Eye size={20} color={Colors.textMuted} />
            )}
          </TouchableOpacity>
        )}
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.s2 },
  label: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.label,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
  input: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.button,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    paddingVertical: 15,
    paddingHorizontal: 16,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  monoInput: {
    fontFamily: Fonts.mono,
    letterSpacing: 0.5,
    color: Colors.navy,
    fontSize: 16,
  },
  focused: {
    borderColor: Colors.borderFocus,
    borderWidth: 2,
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  inputWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  inputWithIcon: {
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.label,
    color: Colors.textMuted,
  },
});
