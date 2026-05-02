import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { X } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { createPost } from '@/lib/api';
import type { Post, PostType } from '@/types';
import { tapHaptic, errorHaptic, successHaptic, selectionHaptic } from '@/lib/haptics';

const POST_TYPES: { value: PostType; label: string }[] = [
  { value: 'question', label: 'Question' },
  { value: 'case_discussion', label: 'Case' },
  { value: 'clinical_pearl', label: 'Pearl' },
  { value: 'resource', label: 'Resource' },
];

const SPECIALTY_OPTIONS = [
  'General Medicine / Internal Medicine',
  'Family Medicine / General Practice',
  'Emergency Medicine',
  'Pediatrics / Child Health',
  'Obstetrics & Gynecology',
  'Surgery (General)',
  'Psychiatry / Mental Health',
  'Cardiology',
  'Neurology',
  'Oncology',
  'Infectious Disease',
  'Public Health / Community Medicine',
];

const PLACEHOLDERS: Record<PostType, string> = {
  question: 'What clinical question do you have for your peers?',
  case_discussion: 'Describe the case — demographics, presentation, investigations, dilemma…',
  clinical_pearl: 'Share a clinical pearl or insight…',
  resource: 'Share a useful resource, guideline, or article…',
};

interface Props {
  visible: boolean;
  token: string;
  onPost: (post: Post) => void;
  onClose: () => void;
}

export function PostComposer({ visible, token, onPost, onClose }: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [content, setContent] = useState('');
  const [postType, setPostType] = useState<PostType>('question');
  const [specialtyTags, setSpecialtyTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setContent('');
    setPostType('question');
    setSpecialtyTags([]);
    setTagInput('');
    setTags([]);
    setIsAnonymous(false);
    setError(null);
  }

  function handleClose() {
    if (submitting) return;
    onClose();
    // Defer reset until after the slide-out so the user doesn't see fields
    // clear mid-animation.
    setTimeout(reset, 250);
  }

  function commitTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput('');
  }

  function toggleSpecialty(s: string) {
    selectionHaptic();
    setSpecialtyTags((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function handleSubmit() {
    if (!content.trim() || submitting) return;
    tapHaptic();
    setSubmitting(true);
    setError(null);
    try {
      const post = await createPost(
        {
          content: content.trim(),
          post_type: postType,
          tags,
          specialty_tags: specialtyTags,
          is_anonymous: isAnonymous,
        },
        token,
      );
      successHaptic();
      onPost(post);
      reset();
    } catch (err) {
      errorHaptic();
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={handleClose}
      presentationStyle="pageSheet"
    >
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleClose}
            disabled={submitting}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New post</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!content.trim() || submitting}
            style={[
              styles.submitButton,
              (!content.trim() || submitting) && styles.submitButtonDisabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitButtonText}>Post</Text>
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Type selector */}
            <View style={styles.typeRow}>
              {POST_TYPES.map(({ value, label }) => {
                const active = postType === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => {
                      selectionHaptic();
                      setPostType(value);
                    }}
                    style={[styles.typeChip, active && styles.typeChipActive]}
                  >
                    <Text
                      style={[
                        styles.typeChipText,
                        active && styles.typeChipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Content */}
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder={PLACEHOLDERS[postType]}
              placeholderTextColor={theme.textMuted}
              multiline
              maxLength={5000}
              textAlignVertical="top"
              style={styles.contentInput}
            />
            <Text style={styles.counter}>{content.length}/5000</Text>

            {/* Specialty chips */}
            <Text style={styles.sectionLabel}>
              Relevant specialties (optional)
            </Text>
            <View style={styles.specialtyWrap}>
              {SPECIALTY_OPTIONS.map((s) => {
                const active = specialtyTags.includes(s);
                return (
                  <TouchableOpacity
                    key={s}
                    onPress={() => toggleSpecialty(s)}
                    style={[
                      styles.specialtyChip,
                      active && styles.specialtyChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.specialtyChipText,
                        active && styles.specialtyChipTextActive,
                      ]}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Tags */}
            <Text style={styles.sectionLabel}>Tags (optional)</Text>
            <View style={styles.tagInputRow}>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="malaria, sepsis, peds…"
                placeholderTextColor={theme.textMuted}
                onSubmitEditing={commitTag}
                returnKeyType="done"
                style={styles.tagInput}
              />
              <TouchableOpacity onPress={commitTag} hitSlop={8}>
                <Text style={styles.tagAdd}>Add</Text>
              </TouchableOpacity>
            </View>
            {tags.length > 0 && (
              <View style={styles.tagWrap}>
                {tags.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => setTags(tags.filter((t) => t !== tag))}
                    style={styles.tagPill}
                  >
                    <Text style={styles.tagPillText}>#{tag} ×</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Anonymous toggle */}
            <TouchableOpacity
              style={styles.anonRow}
              onPress={() => {
                selectionHaptic();
                setIsAnonymous(!isAnonymous);
              }}
              activeOpacity={0.7}
            >
              <View
                style={[styles.toggle, isAnonymous && styles.toggleActive]}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    isAnonymous && styles.toggleThumbActive,
                  ]}
                />
              </View>
              <Text style={styles.anonLabel}>
                Post anonymously (shows &quot;Anonymous Physician&quot;)
              </Text>
            </TouchableOpacity>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    headerTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 16,
      color: theme.text,
    },
    submitButton: {
      backgroundColor: theme.accent,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 999,
      minWidth: 64,
      alignItems: 'center',
    },
    submitButtonDisabled: {
      opacity: 0.4,
    },
    submitButtonText: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: '#FFFFFF',
    },
    body: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 48,
      gap: 16,
    },

    typeRow: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    typeChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    typeChipActive: {
      backgroundColor: theme.pillBg,
      borderColor: theme.accent,
    },
    typeChipText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      color: theme.textMuted,
    },
    typeChipTextActive: {
      color: theme.accent,
      fontFamily: Fonts.sansBold,
    },

    contentInput: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 140,
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.text,
      lineHeight: 20,
    },
    counter: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
      textAlign: 'right',
      marginTop: -10,
    },

    sectionLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      color: theme.textMuted,
      marginBottom: -4,
    },

    specialtyWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    specialtyChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    specialtyChipActive: {
      backgroundColor: theme.pillBg,
      borderColor: theme.accent,
    },
    specialtyChipText: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    specialtyChipTextActive: {
      color: theme.accent,
      fontFamily: Fonts.sansBold,
    },

    tagInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
    },
    tagInput: {
      flex: 1,
      paddingVertical: 9,
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.text,
    },
    tagAdd: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.accent,
    },
    tagWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: -8,
    },
    tagPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: theme.elevated,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
    },
    tagPillText: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },

    anonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    toggle: {
      width: 36,
      height: 20,
      borderRadius: 999,
      backgroundColor: theme.border,
      padding: 2,
    },
    toggleActive: {
      backgroundColor: theme.accent,
    },
    toggleThumb: {
      width: 16,
      height: 16,
      borderRadius: 999,
      backgroundColor: '#FFFFFF',
    },
    toggleThumbActive: {
      transform: [{ translateX: 16 }],
    },
    anonLabel: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.textMuted,
      flex: 1,
    },

    errorBox: {
      backgroundColor: theme.dangerWash,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 12,
      padding: 12,
    },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.danger,
    },
  });
}
