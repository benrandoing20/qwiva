import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Fonts, FontSizes, Spacing, Radii } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import type { ChatMessage, Citation } from '@/types';
import { AnswerMarkdown } from './AnswerMarkdown';

interface ThreadViewProps {
  messages: ChatMessage[];
}

// Distance from the bottom (in points) below which we still consider the user
// "pinned" to the latest message. While pinned, new bubbles auto-scroll into
// view; once the user scrolls further up than this, auto-scroll stays off
// until they swipe back to the bottom themselves.
const PIN_THRESHOLD = 80;

export function ThreadView({ messages }: ThreadViewProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const ref = useRef<ScrollView>(null);

  // Mirrors frontend/app/page.tsx scroll behaviour: only auto-scroll when a
  // *new* bubble is added (messages.length grows), and only if the user is
  // still pinned near the bottom. Token streaming changes message content
  // length but never the count, so it never triggers scroll.
  const userPinnedToBottomRef = useRef(true);
  const messageCountRef = useRef(messages.length);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      userPinnedToBottomRef.current = distFromBottom <= PIN_THRESHOLD;
    },
    [],
  );

  useEffect(() => {
    if (messages.length > messageCountRef.current) {
      messageCountRef.current = messages.length;
      if (userPinnedToBottomRef.current) {
        // Defer to next frame so the new bubble has been laid out.
        requestAnimationFrame(() => {
          ref.current?.scrollToEnd({ animated: true });
        });
      }
    } else if (messages.length < messageCountRef.current) {
      // Conversation switch / clear — resync the counter without scrolling.
      messageCountRef.current = messages.length;
    }
  }, [messages.length]);

  return (
    <ScrollView
      ref={ref}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScroll={handleScroll}
      scrollEventThrottle={64}
      showsVerticalScrollIndicator={true}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.stableKey ?? msg.id} message={msg} theme={theme} />
      ))}
    </ScrollView>
  );
}

function MessageBubble({ message, theme }: { message: ChatMessage; theme: Theme }) {
  const styles = makeStyles(theme);

  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  const showStatus =
    message.isStreaming && !message.content && !!message.statusMessage;
  const isDone = !message.isStreaming;

  return (
    <View style={styles.assistantRow}>
      {message.isError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{message.content}</Text>
        </View>
      ) : showStatus ? (
        <ThinkingDots message={message.statusMessage} theme={theme} />
      ) : (
        <AnswerMarkdown
          content={message.content}
          citations={message.citations ?? []}
          isStreaming={!!message.isStreaming}
          theme={theme}
        />
      )}
      {!message.isError && isDone && (message.citations?.length ?? 0) > 0 && (
        <ReferencesBlock citations={message.citations ?? []} theme={theme} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// References block — mirrors frontend/components/AnswerCard.tsx footer.
// Renders citations as accent pills (matching the inline pill style); tapping
// a pill expands a card with the full title, publisher · year, section, and
// source link.
// ---------------------------------------------------------------------------

// Match the web's abbreviateCitation — produce a short label like "WHO 2024"
// from publisher + year, falling back to a truncated guideline title.
function abbreviateCitation(c: Citation): string {
  const pub = c.publisher ?? '';
  const acr =
    pub.match(/\b(WHO|RCOG|KDIGO|NICE|CDC|AHA|ACC|ESC|FIGO|ICM|ACOG|ACSM|NHS|MOH|KEMRI)\b/i) ??
    pub.match(/\(([A-Z]{2,6})\)/);
  if (acr) return c.year ? `${acr[1].toUpperCase()} ${c.year}` : acr[1].toUpperCase();
  const word = pub.split(/[\s,;(]/)[0];
  if (word && word.length >= 2 && word.length <= 8) {
    return c.year ? `${word} ${c.year}` : word;
  }
  const t = c.guideline_title ?? '';
  return t.length > 14 ? t.slice(0, 14) + '…' : t || String(c.index);
}

function ReferencesBlock({
  citations,
  theme,
}: {
  citations: Citation[];
  theme: Theme;
}) {
  const styles = makeStyles(theme);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Dedup by guideline_title — backend dedup can miss when the same doc is
  // retrieved as two differently-indexed chunks.
  const unique = citations.filter(
    (c, i, arr) =>
      arr.findIndex((x) => x.guideline_title === c.guideline_title) === i,
  );

  const expanded = expandedIndex != null
    ? unique.find((c) => c.index === expandedIndex)
    : null;

  return (
    <View style={styles.referencesBlock}>
      <View style={styles.referencesHeader}>
        <Text style={styles.referencesTitle}>Sources</Text>
      </View>
      <View style={styles.pillsWrap}>
        {unique.map((c) => {
          const isActive = expandedIndex === c.index;
          const label = abbreviateCitation(c);
          return (
            <TouchableOpacity
              key={`${c.index}-${c.guideline_title}`}
              style={[styles.refPill, isActive && styles.refPillActive]}
              activeOpacity={0.7}
              onPress={() =>
                setExpandedIndex((prev) => (prev === c.index ? null : c.index))
              }
            >
              <Text style={[styles.refPillIndex, isActive && styles.refPillIndexActive]}>
                {c.index}
              </Text>
              <Text
                style={[styles.refPillLabel, isActive && styles.refPillLabelActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Expanded detail card — appears when a pill is tapped */}
      {expanded && (
        <View style={styles.expandedCard}>
          <Text style={styles.expandedTitle} numberOfLines={3}>
            {expanded.guideline_title}
          </Text>
          {(expanded.publisher || expanded.year) && (
            <Text style={styles.expandedMeta} numberOfLines={1}>
              {[expanded.publisher, expanded.year].filter(Boolean).join(' · ')}
            </Text>
          )}
          {expanded.section ? (
            <Text style={styles.expandedSection} numberOfLines={2}>
              Section: {expanded.section}
            </Text>
          ) : null}
          {expanded.source_url ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => Linking.openURL(expanded.source_url!)}
              style={styles.expandedLinkRow}
            >
              <Text style={styles.expandedLinkText}>View source ↗</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Thinking dots — three bouncing accent dots + status message
// ---------------------------------------------------------------------------
function ThinkingDots({
  message,
  theme,
}: {
  message?: string;
  theme: Theme;
}) {
  const styles = makeStyles(theme);
  return (
    <View style={styles.thinkingRow}>
      <View style={styles.thinkingDots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, { opacity: 0.6 }]} />
        ))}
      </View>
      <Text style={styles.statusText}>{message ?? 'Thinking…'}</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: Spacing.s5,
      paddingTop: Spacing.s3,
      paddingBottom: Spacing.s4,
      gap: Spacing.s5,
    },

    userRow: { alignItems: 'flex-end' },
    userBubble: {
      maxWidth: '85%',
      backgroundColor: theme.userBubble,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: Radii.card,
      borderTopRightRadius: 4,
    },
    userText: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: theme.text,
      lineHeight: 22,
    },

    assistantRow: {
      alignItems: 'flex-start',
      gap: Spacing.s3,
      width: '100%',
    },

    thinkingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 4,
    },
    thinkingDots: {
      flexDirection: 'row',
      gap: 4,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.accent,
    },
    statusText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
    },

    errorBox: {
      backgroundColor: theme.dangerWash,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: Radii.card,
      padding: Spacing.s3,
    },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.danger,
      lineHeight: 19,
    },

    // References
    referencesBlock: {
      alignSelf: 'stretch',
      marginTop: 4,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      gap: 12,
    },
    referencesHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    referencesTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.textMuted,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    pillsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    refPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.pillBg,
      // Match inline citation pill — no border, just translucent accent fill.
    },
    refPillActive: {
      backgroundColor: theme.accent,
    },
    refPillIndex: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.accent,
      opacity: 0.6,
      lineHeight: 14,
    },
    refPillIndexActive: {
      color: '#FFFFFF',
      opacity: 0.85,
    },
    refPillLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.accent,
      lineHeight: 14,
      letterSpacing: -0.05,
    },
    refPillLabelActive: {
      color: '#FFFFFF',
    },
    expandedCard: {
      marginTop: 4,
      padding: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      gap: 4,
    },
    expandedTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.text,
      lineHeight: 18,
    },
    expandedMeta: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    expandedSection: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
      fontStyle: 'italic',
    },
    expandedLinkRow: {
      marginTop: 6,
      alignSelf: 'flex-start',
    },
    expandedLinkText: {
      fontFamily: Fonts.sansBold,
      fontSize: 12,
      color: theme.accent,
    },
  });
}
