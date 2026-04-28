import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ChevronRight, CheckCircle2, XCircle } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../src/constants';

type State = 'question' | 'correct' | 'wrong';

const OPTIONS = [
  'Artemether–lumefantrine',
  'Chloroquine + primaquine',
  'Quinine monotherapy',
  'Mefloquine',
];
const CORRECT_IDX = 0;

export default function CaseScreen() {
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<State>('question');

  function submit() {
    if (selected === null) return;
    setState(selected === CORRECT_IDX ? 'correct' : 'wrong');
  }

  const showResult = state !== 'question';

  return (
    <SafeAreaView style={styles.container}>
      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <X size={18} color={Colors.navy} />
        </TouchableOpacity>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: '40%' }]} />
          </View>
          <Text style={styles.progressLabel}>4 / 10</Text>
        </View>
        <View style={styles.heartsPill}>
          <Text style={styles.heartsText}>❤ 3</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Case vignette */}
        <View style={styles.vignette}>
          <Text style={styles.vignetteEyebrow}>Case · Infectious Disease</Text>
          <Text style={styles.vignetteTitle}>
            A 34-year-old male presents with 3 days of fever, chills, and headache after returning from a rural area. RDT confirms P. falciparum. No pregnancy. No prior antimalarials this year.
          </Text>
        </View>

        {/* Vitals strip */}
        <View style={styles.vitals}>
          {[
            { label: 'Temp', value: '39.2°C' },
            { label: 'PR', value: '108' },
            { label: 'SpO₂', value: '98%' },
            { label: 'BP', value: '118/74' },
          ].map((v, i) => (
            <View key={i} style={styles.vital}>
              <Text style={styles.vitalLabel}>{v.label}</Text>
              <Text style={styles.vitalValue}>{v.value}</Text>
            </View>
          ))}
        </View>

        {/* Question */}
        <Text style={styles.question}>What is the first-line treatment?</Text>

        {/* Options */}
        <View style={styles.options}>
          {OPTIONS.map((opt, i) => {
            const isCorrect = showResult && i === CORRECT_IDX;
            const isWrong = showResult && i === selected && selected !== CORRECT_IDX;
            const isSelected = !showResult && i === selected;

            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.option,
                  isSelected && styles.optionSelected,
                  isCorrect && styles.optionCorrect,
                  isWrong && styles.optionWrong,
                ]}
                onPress={() => !showResult && setSelected(i)}
                activeOpacity={showResult ? 1 : 0.75}
              >
                <Text style={[
                  styles.optionText,
                  isSelected && { color: Colors.navy },
                  isWrong && { color: Colors.danger },
                ]}>{opt}</Text>
                {isCorrect && <CheckCircle2 size={18} color={Colors.success} />}
                {isWrong && <XCircle size={18} color={Colors.danger} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Feedback card */}
        {showResult && (
          <View style={[styles.feedbackCard, state === 'correct' ? styles.feedbackCorrect : styles.feedbackWrong]}>
            <Text style={[styles.feedbackLabel, { color: state === 'correct' ? Colors.success : Colors.danger }]}>
              {state === 'correct' ? 'Spot on.' : 'Not quite.'}
            </Text>
            <Text style={styles.feedbackBody}>
              {state === 'correct'
                ? 'Artemether–lumefantrine (AL) is the Kenya MoH first-line for uncomplicated P. falciparum in non-pregnant adults. 6-dose regimen over 3 days with food.'
                : 'AL is first-line. Chloroquine resistance is widespread in P. falciparum. Quinine monotherapy is reserved for severe malaria or treatment failure.'}
            </Text>
            <View style={styles.xpPill}>
              <Text style={styles.xpText}>{state === 'correct' ? '+15 XP ✨' : '+0 XP'}</Text>
            </View>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* CTA */}
      <View style={styles.footer}>
        {!showResult ? (
          <TouchableOpacity
            style={[styles.submitBtn, selected === null && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={selected === null}
            activeOpacity={0.82}
          >
            <Text style={styles.submitBtnText}>Check answer</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={() => router.back()}
            activeOpacity={0.82}
          >
            <Text style={styles.nextBtnText}>Next case</Text>
            <ChevronRight size={18} color={Colors.textInverse} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: { flex: 1, gap: 4 },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.bgSurface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.purple,
    borderRadius: 2,
  },
  progressLabel: { fontFamily: Fonts.sansMedium, fontSize: 11, color: Colors.textMuted },
  heartsPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFE5E5',
    borderRadius: Radii.pill,
  },
  heartsText: { fontFamily: Fonts.sansBold, fontSize: 12, color: Colors.heartRed },

  scrollContent: { padding: Spacing.s5, gap: Spacing.s4 },

  vignette: { gap: Spacing.s2 },
  vignetteEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  vignetteTitle: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 23,
  },

  vitals: {
    flexDirection: 'row',
    backgroundColor: Colors.bgNavyWash,
    borderRadius: Radii.button,
    padding: 12,
    gap: 0,
  },
  vital: { flex: 1, alignItems: 'center', gap: 2 },
  vitalLabel: { fontFamily: Fonts.sans, fontSize: 10, color: Colors.textMuted },
  vitalValue: { fontFamily: Fonts.mono, fontSize: 14, color: Colors.navy, fontWeight: '600' },

  question: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.h2,
    color: Colors.navy,
    lineHeight: 30,
  },

  options: { gap: Spacing.s2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: Radii.card,
    borderWidth: 1.5,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
  },
  optionSelected: {
    borderColor: Colors.navy,
    backgroundColor: Colors.bgNavyWash,
  },
  optionCorrect: {
    borderColor: Colors.success,
    backgroundColor: Colors.successWash,
  },
  optionWrong: {
    borderColor: Colors.danger,
    backgroundColor: Colors.dangerWash,
  },
  optionText: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    color: Colors.textPrimary,
    flex: 1,
  },

  feedbackCard: {
    borderRadius: Radii.card,
    padding: 16,
    gap: Spacing.s2,
    borderWidth: 1,
  },
  feedbackCorrect: {
    backgroundColor: Colors.successWash,
    borderColor: 'rgba(45,158,107,0.2)',
  },
  feedbackWrong: {
    backgroundColor: Colors.dangerWash,
    borderColor: 'rgba(192,64,90,0.2)',
  },
  feedbackLabel: { fontFamily: Fonts.sansBold, fontSize: 15 },
  feedbackBody: { fontFamily: Fonts.sans, fontSize: 14, color: Colors.textPrimary, lineHeight: 21 },
  xpPill: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    marginTop: Spacing.s1,
  },
  xpText: { fontFamily: Fonts.sansBold, fontSize: 13, color: Colors.navy },

  footer: { padding: Spacing.s5, paddingBottom: Spacing.s4 },
  submitBtn: {
    backgroundColor: Colors.purple,
    borderRadius: Radii.card,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  submitBtnDisabled: { backgroundColor: Colors.purpleDisabled, shadowOpacity: 0, elevation: 0 },
  submitBtnText: { fontFamily: Fonts.sansBold, fontSize: 16, color: Colors.textInverse },
  nextBtn: {
    backgroundColor: Colors.navy,
    borderRadius: Radii.card,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  nextBtnText: { fontFamily: Fonts.sansBold, fontSize: 16, color: Colors.textInverse },
});
