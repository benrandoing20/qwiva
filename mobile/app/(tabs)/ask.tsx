import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Menu,
  SquarePen,
  ChevronRight,
  Plus,
  Mic,
  Camera,
  ArrowUp,
  Pill,
  HeartPulse,
  Baby,
  Activity,
  ShieldPlus,
} from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { Colors, Fonts, Spacing } from '@/constants';
import { supabase } from '@/lib/supabase';
import { tapHaptic, selectionHaptic } from '@/lib/haptics';
import { SidebarShell, useSidebar } from '@/components/sidebar';
import { ModeSelectorPill, ModeDropdown } from '@/components/header/ModeSelector';
import { ResponseModeId } from '@/constants/responseModes';
import { AddToChatSheet } from '@/components/sheets/AddToChatSheet';

// v1.1: move Suggestion[] into askSuggestions.ts and refactor that
// file from string[] → Record<Cadre, Suggestion[]>. For Slice A the
// content lives inline here so the design lands without a parallel
// constants refactor.
type Suggestion = { icon: string; text: string; meta: string };

const INTERN_SUGGESTIONS: Suggestion[] = [
  { icon: 'pill', text: 'Amoxicillin paeds dosing', meta: 'Under 5y' },
  { icon: 'activity', text: 'DKA fluids — adult', meta: 'Emergency' },
  { icon: 'baby', text: 'MgSO₄ in pre-eclampsia', meta: 'Loading dose' },
  { icon: 'shield-plus', text: 'Adult sepsis bundle', meta: 'First hour' },
];

const MEDICAL_PRACTITIONER_SUGGESTIONS: Suggestion[] = [
  { icon: 'heart-pulse', text: 'HTN in T2DM with proteinuria', meta: 'First-line' },
  { icon: 'pill', text: 'CAP empirical antibiotics', meta: 'Adults' },
  { icon: 'activity', text: 'Statin in CKD 3-4', meta: 'Choice & dose' },
  { icon: 'shield-plus', text: 'PrEP eligibility', meta: 'HIV-negative' },
];

const CLINICAL_OFFICER_SUGGESTIONS: Suggestion[] = [
  { icon: 'pill', text: 'Adult malaria treatment', meta: 'Uncomplicated vs severe' },
  { icon: 'activity', text: 'TB + HIV co-infection', meta: 'When to start' },
  { icon: 'baby', text: 'Paeds pneumonia <5y', meta: 'KEPI protocol' },
  { icon: 'heart-pulse', text: 'Severe anaemia', meta: 'Transfusion thresholds' },
];

const DENTAL_PRACTITIONER_SUGGESTIONS: Suggestion[] = [
  { icon: 'shield-plus', text: 'Endocarditis prophylaxis', meta: 'When to give' },
  { icon: 'baby', text: 'Post-extraction pain — paeds', meta: 'Analgesia' },
  { icon: 'activity', text: 'BRONJ pre-op screening', meta: 'Bisphosphonates' },
  { icon: 'pill', text: 'LA in pregnancy', meta: 'Safe choices' },
];

const FALLBACK_SUGGESTIONS: Suggestion[] = [
  { icon: 'heart-pulse', text: 'New 2026 HTN guidelines', meta: 'What changed' },
  { icon: 'pill', text: 'Warfarin + metronidazole', meta: 'Interaction' },
  { icon: 'activity', text: 'Adult cellulitis', meta: 'First-line' },
  { icon: 'baby', text: 'Paeds paracetamol dosing', meta: 'By weight' },
];

function getCadreSuggestions(cadre: string | null): Suggestion[] {
  switch (cadre) {
    case 'Intern':
      return INTERN_SUGGESTIONS;
    case 'Medical Practitioner':
      return MEDICAL_PRACTITIONER_SUGGESTIONS;
    case 'Clinical Officer':
      return CLINICAL_OFFICER_SUGGESTIONS;
    case 'Dental Practitioner':
      return DENTAL_PRACTITIONER_SUGGESTIONS;
    default:
      return FALLBACK_SUGGESTIONS;
  }
}

function renderSuggestionIcon(name: string) {
  const props = { size: 14, color: Colors.purple };
  switch (name) {
    case 'pill':
      return <Pill {...props} />;
    case 'heart-pulse':
      return <HeartPulse {...props} />;
    case 'baby':
      return <Baby {...props} />;
    case 'shield-plus':
      return <ShieldPlus {...props} />;
    case 'activity':
    default:
      return <Activity {...props} />;
  }
}

interface ProfileSnapshot {
  firstName: string | null;
  cadre: string | null;
}

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getNameLine(firstName: string | null, cadre: string | null): string {
  if (!firstName) return '';
  if (cadre === 'Medical Practitioner' || cadre === 'Dental Practitioner') {
    return `Dr. ${firstName}`;
  }
  return firstName;
}

export default function AskScreen() {
  return (
    <SidebarShell>
      <AskContent />
    </SidebarShell>
  );
}

function AskContent() {
  const sidebar = useSidebar();
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [responseMode, setResponseMode] = useState<ResponseModeId>('default');
  const [adaptiveThinking, setAdaptiveThinking] = useState(true);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [addToChatSheetOpen, setAddToChatSheetOpen] = useState(false);

  const screenOpacity = useSharedValue(0);
  const greetingOpacity = useSharedValue(0);
  const sendProgress = useSharedValue(0);

  // Fetch profile on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (mounted) setProfile({ firstName: null, cadre: null });
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('first_name, cadre')
        .eq('id', user.id)
        .single();
      if (mounted) {
        setProfile({
          firstName: data?.first_name ?? null,
          cadre: data?.cadre ?? null,
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Initial fade-in once profile resolves
  useEffect(() => {
    if (profile === null) return;
    screenOpacity.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.quad),
    });
    greetingOpacity.value = withDelay(
      80,
      withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) })
    );
  }, [profile]);

  // Greeting visibility — fades based on focus and query content.
  // Single opacity animation, no mount/unmount or debounce, so
  // rapid focus/blur cycles transition smoothly without lag.
  useEffect(() => {
    const shouldShow = !inputFocused && query.length === 0;
    greetingOpacity.value = withTiming(shouldShow ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, [inputFocused, query]);

  // Send button background animates between disabled and active
  useEffect(() => {
    sendProgress.value = withTiming(query.trim().length > 0 ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.quad),
    });
  }, [query]);

  const screenStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.value,
  }));

  const greetingStyle = useAnimatedStyle(() => ({
    opacity: greetingOpacity.value,
  }));

  const sendButtonStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      sendProgress.value,
      [0, 1],
      [Colors.borderDefault, Colors.navy]
    ),
  }));

  function handleSubmit() {
    if (!query.trim()) return;
    tapHaptic();
    // TODO Sprint 2: wire RAG submission. Slice A is a no-op.
  }

  function handleMenuPress() {
    tapHaptic();
    sidebar.toggle();
  }

  function handleNewChatPress() {
    tapHaptic();
    sidebar.close();
    setQuery('');
    // TODO Sprint 2: reset thread state when chat history exists.
  }

  function handleAttachmentPress() {
    tapHaptic();
    setAddToChatSheetOpen(true);
  }

  function handleVoicePress() {
    tapHaptic();
    // TODO v1.1: voice dictation.
  }

  function handleCameraPress() {
    tapHaptic();
    // TODO v1.1: image capture for clinical photo questions.
  }

  function handleSuggestionPress(suggestion: Suggestion) {
    selectionHaptic();
    setQuery(suggestion.text);
  }

  const greeting = getTimeBasedGreeting();
  const nameLine = profile ? getNameLine(profile.firstName, profile.cadre) : '';
  const suggestions = getCadreSuggestions(profile?.cadre ?? null);
  const hasQueryText = query.trim().length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.flex} onPress={() => Keyboard.dismiss()}>
          <Animated.View style={[styles.flex, screenStyle]}>
            {/* Top bar */}
            <View style={styles.topBar}>
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleMenuPress}
                activeOpacity={0.75}
              >
                <Menu size={18} color={Colors.navy} />
              </TouchableOpacity>
              <ModeSelectorPill
                modeId={responseMode}
                isOpen={modeDropdownOpen}
                onPress={() => setModeDropdownOpen((v) => !v)}
              />
              <TouchableOpacity
                style={styles.topBarButton}
                onPress={handleNewChatPress}
                activeOpacity={0.75}
              >
                <SquarePen size={17} color={Colors.navy} />
              </TouchableOpacity>
            </View>

            {/* Middle: greeting + suggestions */}
            <View
              style={[
                styles.middle,
                inputFocused ? styles.middleKeyboardUp : styles.middleKeyboardDown,
              ]}
            >
              <Animated.View style={[styles.greetingWrap, greetingStyle]}>
                <Text style={styles.greetingText}>
                  {greeting},{'\n'}
                  {nameLine !== '' && (
                    <Text style={styles.greetingName}>{nameLine}</Text>
                  )}
                </Text>
              </Animated.View>

              {/* Suggestions card — frosted-glass approximation
                  (no expo-blur in Slice A; rgba(255,255,255,0.92)
                  reads close enough on bgBase) */}
              {query.trim().length === 0 && (
                <View
                  style={[
                    styles.suggestionsCard,
                    inputFocused && styles.suggestionsCardKeyboardUp,
                  ]}
                >
                  <Text style={styles.suggestionsHeader}>Try asking</Text>
                  {suggestions.map((s, i) => (
                    <TouchableOpacity
                      key={`${s.icon}-${s.text}`}
                      style={[
                        styles.suggestionRow,
                        i === 0 && styles.suggestionRowFirst,
                      ]}
                      onPress={() => handleSuggestionPress(s)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.suggestionIconWrap}>
                        {renderSuggestionIcon(s.icon)}
                      </View>
                      <View style={styles.suggestionTextWrap}>
                        <Text style={styles.suggestionText}>{s.text}</Text>
                        <Text style={styles.suggestionMeta}>{s.meta}</Text>
                      </View>
                      <ChevronRight size={15} color="#C8C8D8" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Input bar */}
            {/* v1.1: animated conic-gradient rim sweep on keyboard up —
                needs react-native-svg or @shopify/react-native-skia.
                Linear gradient rotation approach failed. */}
            <View
              style={[
                styles.inputWrapper,
                inputFocused ? styles.inputWrapperKeyboardUp : styles.inputWrapperKeyboardDown,
              ]}
            >
              <View style={[styles.inputCard, inputFocused && styles.inputCardFocused]}>
                <TextInput
                  style={styles.inputField}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Ask anything clinical…"
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  multiline
                  maxLength={500}
                />
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.attachButton}
                    onPress={handleAttachmentPress}
                    activeOpacity={0.75}
                  >
                    <Plus size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>

                  <View style={styles.actionSpacer} />

                  <TouchableOpacity
                    style={styles.iconActionButton}
                    onPress={handleVoicePress}
                    activeOpacity={0.75}
                  >
                    <Mic size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconActionButton}
                    onPress={handleCameraPress}
                    activeOpacity={0.75}
                  >
                    <Camera size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>

                  <Animated.View style={[styles.sendButton, sendButtonStyle]}>
                    <TouchableOpacity
                      style={styles.sendButtonInner}
                      onPress={handleSubmit}
                      disabled={!hasQueryText}
                      activeOpacity={0.85}
                    >
                      <ArrowUp
                        size={18}
                        color={hasQueryText ? Colors.textInverse : Colors.textMuted}
                      />
                    </TouchableOpacity>
                  </Animated.View>
                </View>
              </View>
            </View>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
      {modeDropdownOpen && (
        <ModeDropdown
          selectedModeId={responseMode}
          onSelectMode={setResponseMode}
          adaptiveThinking={adaptiveThinking}
          onToggleAdaptiveThinking={() => setAdaptiveThinking((v) => !v)}
          onDismiss={() => setModeDropdownOpen(false)}
        />
      )}
      <AddToChatSheet
        visible={addToChatSheetOpen}
        responseMode={responseMode}
        onSelectMode={setResponseMode}
        onDismiss={() => setAddToChatSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgBase },
  flex: { flex: 1 },

  // Top bar
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
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
    color: Colors.textPrimary,
    letterSpacing: -0.07,
  },

  // Middle section
  middle: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  middleKeyboardDown: {
    justifyContent: 'center',
  },
  middleKeyboardUp: {
    justifyContent: 'flex-start',
    paddingTop: Spacing.s2,
  },

  greetingWrap: {
    alignItems: 'center',
  },
  greetingText: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 38,
    letterSpacing: -0.45,
  },
  greetingName: {
    fontFamily: Fonts.display,
    color: Colors.navy,
  },

  // Suggestions card
  suggestionsCard: {
    marginTop: 26,
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,46,93,0.08)',
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 4,
    overflow: 'hidden',
  },
  suggestionsCardKeyboardUp: {
    marginTop: 0,
  },
  suggestionsHeader: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontFamily: Fonts.sansBold,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,46,93,0.07)',
  },
  suggestionRowFirst: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(111,80,145,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    color: Colors.textPrimary,
    letterSpacing: -0.15,
    lineHeight: 19,
  },
  suggestionMeta: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },

  // Input bar
  inputWrapper: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
  },
  inputWrapperKeyboardDown: {
    marginBottom: 88,
  },
  inputWrapperKeyboardUp: {
    marginBottom: 0,
  },
  inputCard: {
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    borderRadius: 21,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'column',
    gap: 8,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 3,
  },
  inputCardFocused: {
    borderColor: Colors.borderFocus,
    shadowColor: Colors.purple,
    shadowOpacity: 0.18,
    shadowRadius: 22,
  },
  inputField: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 26,
    maxHeight: 80,
    fontFamily: Fonts.sans,
    fontSize: 16,
    color: Colors.textPrimary,
    padding: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attachButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSpacer: {
    flex: 1,
  },
  iconActionButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
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
