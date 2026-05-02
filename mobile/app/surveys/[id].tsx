import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Check } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { fetchSurvey, submitSurveyResponse, getAccessToken } from '@/lib/api';
import {
  errorHaptic,
  selectionHaptic,
  successHaptic,
  tapHaptic,
} from '@/lib/haptics';
import type { Survey, SurveyAnswerInput, SurveyQuestion } from '@/types';

export default function TakeSurveyScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [token, setToken] = useState<string | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerInput>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyResponded, setAlreadyResponded] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await getAccessToken();
      if (!t) {
        router.replace('/onboarding');
        return;
      }
      if (cancelled) return;
      setToken(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    fetchSurvey(id, token)
      .then((s) => {
        if (cancelled) return;
        setSurvey(s);
        if (s.has_responded) setAlreadyResponded(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  function setAnswer(questionId: string, update: Partial<SurveyAnswerInput>) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], question_id: questionId, ...update },
    }));
    setErrors((prev) => ({ ...prev, [questionId]: false }));
  }

  function isAnswered(q: SurveyQuestion): boolean {
    const a = answers[q.id];
    const hasText = !!(a?.answer_text && a.answer_text.trim().length > 0);
    const hasOptions = !!(a?.answer_options && a.answer_options.length > 0);
    if (q.question_type === 'open_text' || q.question_type === 'scale') {
      return hasText;
    }
    return hasOptions;
  }

  function validate(q: SurveyQuestion): boolean {
    if (!q.is_required) return true;
    const ok = isAnswered(q);
    if (!ok) errorHaptic();
    setErrors((prev) => ({ ...prev, [q.id]: !ok }));
    return ok;
  }

  function handleNext() {
    if (!survey?.questions) return;
    const q = survey.questions[currentIndex];
    if (!validate(q)) return;
    tapHaptic();
    setCurrentIndex((i) =>
      Math.min(i + 1, (survey.questions?.length ?? 1) - 1),
    );
  }

  function handleBack() {
    tapHaptic();
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }

  async function handleSubmit() {
    if (!survey?.questions || !token || !id) return;
    const last = survey.questions[currentIndex];
    if (last && !validate(last)) return;
    tapHaptic();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitSurveyResponse(id, Object.values(answers), token);
      successHaptic();
      setSubmitted(true);
    } catch (err) {
      errorHaptic();
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('422') || msg.toLowerCase().includes('already responded')) {
        setAlreadyResponded(true);
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ----- States -----
  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader theme={theme} title="" onBack={() => router.back()} />
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={theme.textMuted} />
        </View>
      </View>
    );
  }

  if (!survey) {
    return (
      <View style={styles.root}>
        <ScreenHeader theme={theme} title="" onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={styles.notFound}>Survey not found.</Text>
        </View>
      </View>
    );
  }

  if (alreadyResponded) {
    return (
      <View style={styles.root}>
        <ScreenHeader theme={theme} title={survey.title} onBack={() => router.back()} />
        <View style={styles.centered}>
          <View style={styles.terminalCard}>
            <View style={styles.terminalIcon}>
              <Check size={26} color={theme.accent} />
            </View>
            <Text style={styles.terminalTitle}>Already submitted</Text>
            <Text style={styles.terminalBody}>
              You have already responded to this survey.
            </Text>
            <TouchableOpacity
              style={styles.terminalButton}
              onPress={() => router.replace('/surveys')}
              activeOpacity={0.85}
            >
              <Text style={styles.terminalButtonText}>Back to Surveys</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (submitted) {
    return (
      <View style={styles.root}>
        <ScreenHeader theme={theme} title={survey.title} onBack={() => router.replace('/surveys')} />
        <View style={styles.centered}>
          <View style={styles.terminalCard}>
            <View style={styles.terminalIcon}>
              <Check size={26} color={theme.accent} />
            </View>
            <Text style={styles.terminalTitle}>Thank you!</Text>
            <Text style={styles.terminalBody}>
              Your response to “{survey.title}” has been recorded.
            </Text>
            <TouchableOpacity
              style={styles.terminalButton}
              onPress={() => router.replace('/surveys')}
              activeOpacity={0.85}
            >
              <Text style={styles.terminalButtonText}>Back to Surveys</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const questions = survey.questions ?? [];
  const total = questions.length;
  const q = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;
  const progressPct = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;

  return (
    <View style={styles.root}>
      <ScreenHeader theme={theme} title={survey.title} onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Title block */}
          <View style={styles.titleBlock}>
            <Text style={styles.surveyTitle}>{survey.title}</Text>
            {survey.description ? (
              <Text style={styles.surveyDescription}>{survey.description}</Text>
            ) : null}
            {survey.estimated_minutes ? (
              <Text style={styles.surveyMeta}>
                Est. {survey.estimated_minutes} minutes
              </Text>
            ) : null}
          </View>

          {/* Progress */}
          {total > 0 && (
            <View style={styles.progressBlock}>
              <View style={styles.progressRow}>
                <Text style={styles.progressLabel}>
                  Question {currentIndex + 1} of {total}
                </Text>
                <Text style={styles.progressPct}>
                  {Math.round(progressPct)}%
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progressPct}%` }]}
                />
              </View>
            </View>
          )}

          {/* Question card */}
          {q && (
            <QuestionCard
              question={q}
              answer={answers[q.id]}
              error={errors[q.id]}
              onChange={(update) => setAnswer(q.id, update)}
              theme={theme}
            />
          )}

          {submitError ? (
            <Text style={styles.submitError}>{submitError}</Text>
          ) : null}
        </ScrollView>

        {/* Footer actions */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => (isFirst ? router.back() : handleBack())}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>
              {isFirst ? 'Cancel' : '← Back'}
            </Text>
          </TouchableOpacity>
          {isLast ? (
            <TouchableOpacity
              style={[
                styles.primaryButton,
                submitting && styles.primaryButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Submit</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Next →</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ScreenHeader({
  theme,
  title,
  onBack,
}: {
  theme: Theme;
  title: string;
  onBack: () => void;
}) {
  const styles = makeStyles(theme);
  return (
    <View style={styles.headerBar}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={12}
        style={styles.headerBack}
      >
        <ChevronLeft size={22} color={theme.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function QuestionCard({
  question,
  answer,
  error,
  onChange,
  theme,
}: {
  question: SurveyQuestion;
  answer?: SurveyAnswerInput;
  error?: boolean;
  onChange: (update: Partial<SurveyAnswerInput>) => void;
  theme: Theme;
}) {
  const styles = makeStyles(theme);
  return (
    <View style={styles.questionCard}>
      <Text style={styles.questionText}>
        {question.question_text}
        {question.is_required ? (
          <Text style={styles.requiredMark}> *</Text>
        ) : null}
      </Text>

      {question.question_type === 'multiple_choice' && (
        <View style={styles.optionsList}>
          {(question.options ?? []).map((opt) => {
            const selected = answer?.answer_options?.[0] === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => {
                  selectionHaptic();
                  onChange({ answer_options: [opt.id] });
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.radio,
                    selected && styles.radioSelected,
                  ]}
                >
                  {selected ? <View style={styles.radioInner} /> : null}
                </View>
                <Text
                  style={[
                    styles.optionText,
                    selected && styles.optionTextSelected,
                  ]}
                >
                  {opt.text}
                </Text>
              </TouchableOpacity>
            );
          })}
          {error ? (
            <Text style={styles.errorText}>This question is required</Text>
          ) : null}
        </View>
      )}

      {question.question_type === 'multi_select' && (
        <View style={styles.optionsList}>
          {(question.options ?? []).map((opt) => {
            const selected = answer?.answer_options ?? [];
            const checked = selected.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.option, checked && styles.optionSelected]}
                onPress={() => {
                  selectionHaptic();
                  const next = checked
                    ? selected.filter((x) => x !== opt.id)
                    : [...selected, opt.id];
                  onChange({ answer_options: next });
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.checkbox,
                    checked && styles.checkboxSelected,
                  ]}
                >
                  {checked ? <Check size={12} color="#FFFFFF" /> : null}
                </View>
                <Text
                  style={[
                    styles.optionText,
                    checked && styles.optionTextSelected,
                  ]}
                >
                  {opt.text}
                </Text>
              </TouchableOpacity>
            );
          })}
          {error ? (
            <Text style={styles.errorText}>This question is required</Text>
          ) : null}
        </View>
      )}

      {question.question_type === 'scale' && (
        <ScaleInput
          question={question}
          value={answer?.answer_text ?? undefined}
          onChange={(v) => onChange({ answer_text: v })}
          theme={theme}
          error={error}
        />
      )}

      {question.question_type === 'open_text' && (
        <View style={styles.openText}>
          <TextInput
            value={answer?.answer_text ?? ''}
            onChangeText={(t) => onChange({ answer_text: t })}
            placeholder="Your response…"
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            style={styles.openTextInput}
          />
          {error ? (
            <Text style={styles.errorText}>This question is required</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function ScaleInput({
  question,
  value,
  onChange,
  theme,
  error,
}: {
  question: SurveyQuestion;
  value?: string;
  onChange: (v: string) => void;
  theme: Theme;
  error?: boolean;
}) {
  const styles = makeStyles(theme);
  const min = question.scale_min ?? 1;
  const max = question.scale_max ?? 5;
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <View style={styles.scaleBlock}>
      <View style={styles.scaleRow}>
        {steps.map((n) => {
          const selected = value === String(n);
          return (
            <TouchableOpacity
              key={n}
              style={[styles.scaleStep, selected && styles.scaleStepSelected]}
              onPress={() => {
                selectionHaptic();
                onChange(String(n));
              }}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.scaleStepText,
                  selected && styles.scaleStepTextSelected,
                ]}
              >
                {n}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {(question.scale_min_label || question.scale_max_label) && (
        <View style={styles.scaleLabels}>
          <Text style={styles.scaleLabel}>{question.scale_min_label ?? ''}</Text>
          <Text style={styles.scaleLabel}>{question.scale_max_label ?? ''}</Text>
        </View>
      )}
      {error ? (
        <Text style={styles.errorText}>This question is required</Text>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    flex: { flex: 1 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    notFound: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.textMuted,
    },

    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 60,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      gap: 8,
    },
    headerBack: { padding: 4 },
    headerTitle: {
      flex: 1,
      fontFamily: Fonts.sansBold,
      fontSize: 15,
      color: theme.text,
    },
    headerSpacer: { width: 22 },

    scrollContent: {
      padding: 16,
      paddingBottom: 32,
      gap: 18,
    },

    titleBlock: { gap: 4 },
    surveyTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 20,
      color: theme.text,
      letterSpacing: -0.3,
      lineHeight: 26,
    },
    surveyDescription: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
      lineHeight: 19,
    },
    surveyMeta: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
      marginTop: 2,
    },

    progressBlock: { gap: 6 },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    progressLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 11,
      color: theme.textMuted,
    },
    progressPct: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    progressTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.elevated,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: theme.accent,
    },

    questionCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      padding: 16,
      gap: 12,
    },
    questionText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 15,
      color: theme.text,
      lineHeight: 21,
    },
    requiredMark: {
      color: theme.danger,
    },

    optionsList: { gap: 8 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      backgroundColor: theme.bg,
    },
    optionSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.pillBg,
    },
    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: {
      borderColor: theme.accent,
    },
    radioInner: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: theme.accent,
    },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.accent,
    },
    optionText: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.text,
      flex: 1,
    },
    optionTextSelected: {
      fontFamily: Fonts.sansMedium,
    },

    scaleBlock: { gap: 6 },
    scaleRow: {
      flexDirection: 'row',
      gap: 6,
    },
    scaleStep: {
      flex: 1,
      aspectRatio: 1,
      maxWidth: 56,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.bg,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scaleStepSelected: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    scaleStepText: {
      fontFamily: Fonts.sansBold,
      fontSize: 14,
      color: theme.text,
    },
    scaleStepTextSelected: {
      color: '#FFFFFF',
    },
    scaleLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    scaleLabel: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },

    openText: { gap: 4 },
    openTextInput: {
      backgroundColor: theme.bg,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      padding: 12,
      minHeight: 100,
      maxHeight: 240,
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.text,
      lineHeight: 20,
    },

    errorText: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.danger,
      marginTop: 2,
    },
    submitError: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.danger,
      textAlign: 'center',
    },

    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 28 : 14,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.bg,
      gap: 8,
    },
    secondaryButton: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: theme.elevated,
    },
    secondaryButtonText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 13,
      color: theme.textMuted,
    },
    primaryButton: {
      paddingHorizontal: 22,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: theme.accent,
      minWidth: 96,
      alignItems: 'center',
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    primaryButtonText: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: '#FFFFFF',
    },

    terminalCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 20,
      padding: 24,
      alignItems: 'center',
      gap: 8,
      width: '100%',
      maxWidth: 360,
    },
    terminalIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: theme.pillBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    terminalTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 17,
      color: theme.text,
    },
    terminalBody: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
      textAlign: 'center',
      lineHeight: 19,
    },
    terminalButton: {
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: theme.elevated,
    },
    terminalButtonText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 13,
      color: theme.text,
    },
  });
}
