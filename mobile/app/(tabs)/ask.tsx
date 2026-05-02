import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Menu, SquarePen, ArrowUp, RefreshCw } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { Fonts, Spacing } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { tapHaptic, selectionHaptic } from '@/lib/haptics';
import { SidebarShell, useSidebar } from '@/components/sidebar';
import { ThreadView } from '@/components/ask/ThreadView';
import { ChatProvider, useChat } from '@/contexts/ChatContext';

// Mirror frontend/app/page.tsx CLINICAL_QUESTIONS — keep the two pools in sync
// when adding/removing questions on either platform.
const CLINICAL_QUESTIONS: string[] = [
  // Malaria
  'What is the first-line treatment for uncomplicated malaria in adults?',
  'How should severe malaria be managed in a pregnant woman?',
  'When should IV artesunate be used instead of artemether-lumefantrine?',
  // HIV / TB
  'Which ARV regimen is recommended in the first trimester of pregnancy?',
  'How should ART be initiated in a patient with active tuberculosis?',
  'What prophylaxis is recommended for Pneumocystis pneumonia in HIV?',
  // Maternal health
  'What are the steps for managing postpartum haemorrhage?',
  'When is magnesium sulphate indicated in pre-eclampsia?',
  'What is the recommended dose of oxytocin in active third-stage management?',
  // Paediatrics / nutrition
  'How is severe acute malnutrition managed in a child under 5?',
  'What are the criteria for inpatient treatment of severe acute malnutrition?',
  'Which antibiotics are used in complicated severe acute malnutrition?',
  // Nephrology (KDIGO)
  'What is the target blood pressure in CKD patients with proteinuria?',
  'When should dialysis be initiated in acute kidney injury?',
  'How should cyclophosphamide be dosed in lupus nephritis?',
  // Infectious disease
  'What antibiotics are recommended for community-acquired pneumonia in adults?',
  'How should urinary tract infections in pregnancy be treated?',
  'What is the empirical antibiotic regimen for adult sepsis?',
  // Cardiology / endocrine
  'When is anticoagulation indicated in atrial fibrillation?',
  'How should a hypertensive emergency be managed acutely?',
  'What is the glycaemic target for type 2 diabetes in adults?',
  'When should insulin be initiated in type 2 diabetes?',
  // Drug-specific
  'What are the pharmacokinetics of cyclophosphamide?',
  'What adverse effects of amiodarone require monitoring?',
];

function pickRandom(pool: string[], n: number, exclude: string[] = []): string[] {
  const available = pool.filter((q) => !exclude.includes(q));
  return [...available].sort(() => Math.random() - 0.5).slice(0, n);
}

export default function AskScreen() {
  return (
    <ChatProvider>
      <SidebarShell>
        <AskContent />
      </SidebarShell>
    </ChatProvider>
  );
}

function AskContent() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const sidebar = useSidebar();
  const { messages, isStreaming, send, newChat } = useChat();
  const [query, setQuery] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const initialQuestions = useMemo(() => CLINICAL_QUESTIONS.slice(0, 3), []);
  const [shownQuestions, setShownQuestions] = useState<string[]>(initialQuestions);

  useEffect(() => {
    setShownQuestions(pickRandom(CLINICAL_QUESTIONS, 3));
  }, []);

  const screenOpacity = useSharedValue(0);
  const sendProgress = useSharedValue(0);

  useEffect(() => {
    screenOpacity.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
  }, []);

  useEffect(() => {
    sendProgress.value = withTiming(query.trim().length > 0 ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, [query]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));
  const sendButtonStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      sendProgress.value,
      [0, 1],
      [theme.border, theme.accent],
    ),
  }));

  async function handleSubmit() {
    const trimmed = query.trim();
    if (!trimmed || isStreaming) return;
    tapHaptic();
    Keyboard.dismiss();
    setQuery('');
    await send(trimmed);
  }

  function handleMenuPress() {
    tapHaptic();
    sidebar.toggle();
  }

  function handleNewChatPress() {
    tapHaptic();
    sidebar.close();
    setQuery('');
    newChat();
  }

  function handleSuggestionPress(suggestion: string) {
    if (isStreaming) return;
    selectionHaptic();
    Keyboard.dismiss();
    send(suggestion);
  }

  function handleRefreshSuggestions() {
    selectionHaptic();
    setShownQuestions((prev) => pickRandom(CLINICAL_QUESTIONS, 3, prev));
  }

  const hasQueryText = query.trim().length > 0;
  const hasMessages = messages.length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <Animated.View style={[styles.flex, screenStyle]}>
            {/* Top bar */}
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleMenuPress}
                activeOpacity={0.75}
              >
                <Menu size={18} color={theme.text} />
              </TouchableOpacity>
              <Image
                source={
                  theme.scheme === 'dark'
                    ? require('../../assets/logo-for-dark-bg.png')
                    : require('../../assets/logo-for-light-bg.png')
                }
                style={styles.topBarLogo}
                resizeMode="contain"
              />
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleNewChatPress}
                activeOpacity={0.75}
              >
                <SquarePen size={17} color={theme.text} />
              </TouchableOpacity>
            </View>

            {hasMessages ? (
              <ThreadView messages={messages} />
            ) : (
              <TouchableWithoutFeedback
                onPress={() => Keyboard.dismiss()}
                accessible={false}
              >
                <View style={styles.heroWrap}>
                  <Text style={styles.tagline}>
                    Kenya&apos;s clinical knowledge platform
                  </Text>

                <View style={styles.suggestionsList}>
                  {shownQuestions.map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={styles.suggestionRow}
                      onPress={() => handleSuggestionPress(q)}
                      disabled={isStreaming}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.suggestionText} numberOfLines={3}>
                        {q}
                      </Text>
                      <Text style={styles.suggestionArrow}>→</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.refreshRow}
                    onPress={handleRefreshSuggestions}
                    activeOpacity={0.7}
                  >
                    <RefreshCw size={12} color={theme.textMuted} />
                    <Text style={styles.refreshLabel}>Refresh</Text>
                  </TouchableOpacity>
                </View>
                </View>
              </TouchableWithoutFeedback>
            )}

            {/* Input bar */}
            <View
              style={[
                styles.inputWrapper,
                inputFocused
                  ? styles.inputWrapperKeyboardUp
                  : styles.inputWrapperKeyboardDown,
              ]}
            >
              <View style={[styles.inputCard, inputFocused && styles.inputCardFocused]}>
                <TextInput
                  style={styles.inputField}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Ask anything clinical…"
                  placeholderTextColor={theme.textMuted}
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  multiline
                  maxLength={500}
                />
                <Animated.View style={[styles.sendButton, sendButtonStyle]}>
                  <TouchableOpacity
                    style={styles.sendButtonInner}
                    onPress={handleSubmit}
                    disabled={!hasQueryText || isStreaming}
                    activeOpacity={0.85}
                  >
                    <ArrowUp
                      size={18}
                      color={hasQueryText ? theme.textInverse : theme.textMuted}
                    />
                  </TouchableOpacity>
                </Animated.View>
              </View>
            </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    flex: { flex: 1 },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: Spacing.s2,
      paddingBottom: Spacing.s2,
    },
    topBarButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topBarLogo: {
      width: 105,
      height: 24,
    },

    heroWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingBottom: 80,
    },
    tagline: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.textMuted,
      letterSpacing: -0.1,
      textAlign: 'center',
      marginBottom: 24,
    },

    suggestionsList: {
      width: '100%',
      maxWidth: 480,
      gap: 6,
    },
    suggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
    },
    suggestionText: {
      flex: 1,
      fontFamily: Fonts.sans,
      fontSize: 12.5,
      color: theme.text,
      lineHeight: 17,
      opacity: 0.85,
    },
    suggestionArrow: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.textMuted,
    },
    refreshRow: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginTop: 4,
    },
    refreshLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      color: theme.textMuted,
    },

    inputWrapper: {
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 12,
    },
    inputWrapperKeyboardDown: { marginBottom: 88 },
    inputWrapperKeyboardUp: { marginBottom: 0 },
    inputCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 21,
      paddingHorizontal: 14,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      shadowColor: theme.navy,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: theme.scheme === 'dark' ? 0.4 : 0.1,
      shadowRadius: 18,
      elevation: 3,
    },
    inputCardFocused: {
      borderColor: theme.borderFocus,
      shadowColor: theme.accent,
      shadowOpacity: 0.18,
      shadowRadius: 22,
    },
    inputField: {
      flex: 1,
      minHeight: 36,
      maxHeight: 96,
      fontFamily: Fonts.sans,
      fontSize: 16,
      lineHeight: 22,
      color: theme.text,
      paddingHorizontal: 0,
      paddingTop: Platform.OS === 'ios' ? 8 : 6,
      paddingBottom: Platform.OS === 'ios' ? 8 : 6,
      textAlignVertical: 'center',
    },
    sendButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonInner: {
      width: '100%',
      height: '100%',
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
