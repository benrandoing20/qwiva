import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Modal,
  Pressable,
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

  // When the last assistant message finishes streaming, the ReferencesBlock
  // mounts below the answer text. Re-scroll to bottom if the user was
  // pinned, otherwise the refs render off-screen and look "missing".
  const lastIsStreaming = messages[messages.length - 1]?.isStreaming ?? false;
  useEffect(() => {
    if (lastIsStreaming) return;
    if (!userPinnedToBottomRef.current) return;
    // Two RAFs: one to let RN flush the layout pass that adds the refs
    // block, one more to let its measured height be reflected in the
    // ScrollView's contentSize before we scroll.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ref.current?.scrollToEnd({ animated: true });
      });
    });
  }, [lastIsStreaming]);

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
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

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
          onCitationPress={setActiveCitation}
        />
      )}
      {/* Refs render as a sibling of AnswerMarkdown — outside the unveil
          curtain — so they stay statically visible the entire time
          (including during streaming). The curtain only reveals the
          answer text; refs are not part of the reveal. */}
      {!message.isError && (message.citations?.length ?? 0) > 0 && (
        <ReferencesBlock
          citations={message.citations ?? []}
          theme={theme}
          onCitationPress={setActiveCitation}
        />
      )}
      <CitationSheet
        citation={activeCitation}
        theme={theme}
        onClose={() => setActiveCitation(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// References block — mirrors frontend/components/AnswerCard.tsx footer.
// Renders each citation as an accent pill; tapping any pill opens the
// shared `CitationSheet` (slide-up modal) with the full reference detail.
// ---------------------------------------------------------------------------

function ReferencesBlock({
  citations,
  theme,
  onCitationPress,
}: {
  citations: Citation[];
  theme: Theme;
  onCitationPress: (citation: Citation) => void;
}) {
  const styles = makeStyles(theme);

  // Dedup by guideline_title — backend dedup can miss when the same doc is
  // retrieved as two differently-indexed chunks.
  const unique = citations.filter(
    (c, i, arr) =>
      arr.findIndex((x) => x.guideline_title === c.guideline_title) === i,
  );

  return (
    <View style={styles.referencesBlock}>
      <View style={styles.referencesHeader}>
        <Text style={styles.referencesTitle}>Sources</Text>
      </View>
      <View style={styles.refList}>
        {unique.map((c) => {
          const meta = [c.publisher, c.year].filter(Boolean).join(' · ');
          return (
            <TouchableOpacity
              key={`${c.index}-${c.guideline_title}`}
              style={styles.refRow}
              activeOpacity={0.7}
              onPress={() => onCitationPress(c)}
            >
              <View style={styles.refRowPill}>
                <Text style={styles.refRowPillText}>{c.index}</Text>
              </View>
              <View style={styles.refRowBody}>
                <Text style={styles.refRowTitle} numberOfLines={3}>
                  {c.guideline_title}
                  {c.source_url ? <Text style={styles.refRowLink}>{'  ↗'}</Text> : null}
                </Text>
                {meta ? (
                  <Text style={styles.refRowMeta} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Bottom sheet that pops up when a citation pill is tapped — shows the
// full guideline title, publisher · year, section, and a "View source"
// link. Uses RN's built-in Modal with `animationType="slide"` and a
// fully transparent backdrop so the page underneath stays visible
// (no dark overlay). Tapping above the sheet dismisses.
function CitationSheet({
  citation,
  theme,
  onClose,
}: {
  citation: Citation | null;
  theme: Theme;
  onClose: () => void;
}) {
  const styles = makeStyles(theme);
  const visible = citation !== null;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetContainer} onPress={() => undefined}>
          <View style={styles.sheetGrabber} />
          {citation ? (
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sheetEyebrow}>
                Reference {citation.index}
              </Text>
              <Text style={styles.sheetTitle}>{citation.guideline_title}</Text>
              {(citation.publisher || citation.year) && (
                <Text style={styles.sheetMeta}>
                  {[citation.publisher, citation.year].filter(Boolean).join(' · ')}
                </Text>
              )}
              {citation.section ? (
                <Text style={styles.sheetSection}>
                  Section: {citation.section}
                </Text>
              ) : null}
              {citation.source_url ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => Linking.openURL(citation.source_url!)}
                  style={styles.sheetLinkRow}
                >
                  <Text style={styles.sheetLinkText}>View source ↗</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
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
    // Full reference list — each row is the small numbered pill plus the
    // guideline title and publisher · year. Tapping a row opens the
    // shared CitationSheet with the full detail.
    refList: {
      gap: 10,
    },
    refRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    refRowPill: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 7,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.pillBg,
      overflow: 'hidden',
      marginTop: 1,
    },
    refRowPillText: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.accent,
      lineHeight: 14,
      letterSpacing: -0.1,
    },
    refRowBody: {
      flex: 1,
      minWidth: 0,
    },
    refRowTitle: {
      fontFamily: Fonts.sansMedium,
      fontSize: 13,
      color: theme.text,
      lineHeight: 18,
    },
    refRowLink: {
      color: theme.accent,
      fontSize: 11,
    },
    refRowMeta: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
      marginTop: 2,
    },

    // Citation bottom sheet — fully transparent backdrop so the page
    // underneath stays visible (no dark overlay).
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'transparent',
      justifyContent: 'flex-end',
    },
    sheetContainer: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.border,
      paddingTop: 8,
      paddingBottom: 24,
      maxHeight: '75%',
      // Lift the sheet visually without needing a dim overlay.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 12,
    },
    sheetGrabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginBottom: 8,
    },
    sheetScroll: {
      paddingHorizontal: 20,
    },
    sheetContent: {
      paddingTop: 8,
      paddingBottom: 12,
      gap: 6,
    },
    sheetEyebrow: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.textMuted,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    sheetTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 16,
      color: theme.text,
      lineHeight: 22,
    },
    sheetMeta: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.textMuted,
    },
    sheetSection: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.textMuted,
      fontStyle: 'italic',
    },
    sheetLinkRow: {
      marginTop: 12,
      alignSelf: 'flex-start',
    },
    sheetLinkText: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.accent,
    },
  });
}
