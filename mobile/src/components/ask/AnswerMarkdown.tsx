// Streaming markdown renderer for assistant answers. Replaces the previous
// per-character "typewriter" drain with a word-level reveal that feels closer
// to OpenEvidence: tokens are buffered as they arrive, then flushed one word
// at a time on a ~80 ms cadence. Each emerging paragraph fades in via a
// Reanimated `entering` animation so the user never sees a hard chunk dump —
// just a smooth, continuous fade as content keeps arriving.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown, { type ASTNode } from 'react-native-markdown-display';
import { Fonts } from '@/constants';
import type { Citation } from '@/types';
import type { Theme } from '@/hooks/useTheme';

interface Props {
  content: string;
  citations: Citation[];
  isStreaming: boolean;
  theme: Theme;
  onCitationPress?: (citation: Citation) => void;
}

// ---------------------------------------------------------------------------
// Compress adjacent citation runs: [1][2][3] -> [1-3]; matches the web.
// ---------------------------------------------------------------------------
function compressCitations(text: string): string {
  return text.replace(/(\[\d+\])+/g, (match) => {
    const nums = [...match.matchAll(/\[(\d+)\]/g)]
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = nums[0];
    let end = nums[0];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === end + 1) {
        end = nums[i];
      } else {
        ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`);
        start = nums[i];
        end = nums[i];
      }
    }
    ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`);
    return ranges.join('');
  });
}

// While the model is mid-formatting, the buffered text can contain markdown
// openers that haven't been closed yet (e.g. `**bold` with no trailing `**`).
// If we hand that to the renderer the user sees the literal `**` characters
// flash on screen until the closer arrives. To avoid that, we trim the
// displayed text back to the last position where every paired marker is
// balanced and there's no in-progress link (`[…]…` without `)`).
const PAIR_MARKERS = ['**', '__', '~~', '`'];

function findUnclosedPair(text: string, marker: string): number | null {
  const positions: number[] = [];
  let i = 0;
  while ((i = text.indexOf(marker, i)) !== -1) {
    positions.push(i);
    i += marker.length;
  }
  return positions.length % 2 === 1
    ? positions[positions.length - 1]
    : null;
}

function trimUnclosedMarkers(text: string): string {
  if (!text) return text;
  let cutoff = text.length;
  for (const m of PAIR_MARKERS) {
    const pos = findUnclosedPair(text, m);
    if (pos !== null && pos < cutoff) cutoff = pos;
  }
  // Unclosed link / image: a `[` that doesn't yet have a matching `]`, or a
  // `](` that doesn't yet have its closing `)`.
  const lastOpenBracket = text.lastIndexOf('[');
  if (lastOpenBracket !== -1) {
    const afterBracket = text.slice(lastOpenBracket);
    // Citation pills like `[1]` or `[1-3]` are fine — they always close
    // quickly and we don't want to hide them.
    const citationLike = /^\[\d+(?:-\d+)?\]/.test(afterBracket);
    if (!citationLike) {
      // Find ']' for this open bracket. If missing, hide everything from
      // the bracket onward.
      const closeBracketRel = afterBracket.indexOf(']');
      if (closeBracketRel === -1) {
        if (lastOpenBracket < cutoff) cutoff = lastOpenBracket;
      } else {
        // We have `[…]`; if the next two chars are `(`, we're in a link and
        // need to wait for the matching `)`.
        const afterClose = afterBracket.slice(closeBracketRel + 1);
        if (afterClose.startsWith('(') && !afterClose.includes(')')) {
          if (lastOpenBracket < cutoff) cutoff = lastOpenBracket;
        }
      }
    }
  }
  // Trim any trailing whitespace introduced by the cut so we don't leave a
  // ragged blank tail.
  return text.slice(0, cutoff).replace(/\s+$/, '');
}

// Mirror web's checkbox normaliser. Strips ☐ and reformats inline lists into
// real markdown bullets so the renderer treats them as a list.
function normaliseCheckboxes(text: string): string {
  if (!text.includes('☐')) return text;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('☐') || trimmed.includes('. ☐')) {
        const items = trimmed
          .split(/\s*\.\s*☐\s*/)
          .map((s) => s.replace(/^☐\s*/, '').replace(/\s*\.$/, '').trim())
          .filter(Boolean);
        return items.map((item) => `- ${item}`).join('\n');
      }
      return line;
    })
    .join('\n');
}

const CITATION_RE = /\[(\d+)(?:-(\d+))?\]/g;

// Mirrors web's abbreviateCitation in StreamingText.tsx: produces a short
// publisher/year label like "WHO 2023" so the inline pill has body and
// matches the OpenEvidence-style appearance.
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
  return t.length > 12 ? t.slice(0, 12) + '…' : t || String(c.index);
}

// Inline citation pill — number + publisher acronym. Rendered as a `<View>`
// (not a `<Text>`) so the rounded background actually clips: RN's `<Text>`
// drops `borderRadius` on its `backgroundColor` when the Text is nested
// inside another Text (which is what the markdown paragraph wraps us in),
// and ignores `padding` on nested Text on iOS. Putting the Text *inside* a
// View lets the View clip reliably on both iOS and Android. `alignSelf:
// 'baseline'` keeps the pill aligned with the surrounding text line.
//
// Tap behaviour: defers to the parent's `onPress` callback (which opens a
// bottom sheet); falls back to opening source_url directly only when no
// callback is wired.
function CitationPill({
  indexLabel,
  citation,
  theme,
  onPress,
}: {
  indexLabel: string;
  citation?: Citation;
  theme: Theme;
  onPress?: (citation: Citation) => void;
}) {
  const styles = makePillStyles(theme);
  const label = citation ? abbreviateCitation(citation) : null;
  const handlePress = citation
    ? onPress
      ? () => onPress(citation)
      : citation.source_url
        ? () => Linking.openURL(citation.source_url!)
        : undefined
    : undefined;
  return (
    <Pressable
      style={styles.pill}
      onPress={handlePress}
      disabled={!handlePress}
    >
      <Text style={styles.pillText}>
        <Text style={styles.pillNum}>{indexLabel}</Text>
        {label ? <Text>{` ${label}`}</Text> : null}
      </Text>
    </Pressable>
  );
}

function makePillStyles(theme: Theme) {
  return StyleSheet.create({
    pill: {
      // Explicit `height` + `borderRadius = height / 2` is what produces a
      // true stadium shape, regardless of the text glyph metrics inside.
      height: 18,
      paddingHorizontal: 7,
      borderRadius: 9,
      backgroundColor: theme.pillBg,
      flexDirection: 'row',
      alignItems: 'center',
      // Sit on the text baseline so the pill flows inline with the
      // surrounding paragraph instead of stretching the line height.
      alignSelf: 'baseline',
      overflow: 'hidden',
    },
    pillText: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      lineHeight: 14,
      color: theme.accent,
    },
    pillNum: {
      opacity: 0.6,
    },
  });
}


// Tokenise a raw string fragment into alternating word / whitespace / pill
// nodes. The render layer then wraps each *word* in an Animated.Text with
// FadeIn so newly-arrived words gracefully unveil while older ones stay
// solid. Whitespace and punctuation aren't animated — only the meaningful
// content is, which is what produces the OpenEvidence-style reveal.
type Segment =
  | { kind: 'word'; value: string }
  | { kind: 'ws'; value: string }
  | { kind: 'pill'; indexLabel: string; citation?: Citation };

function tokenize(raw: string, citations: Citation[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;

  function pushText(s: string) {
    if (!s) return;
    // Split into runs of whitespace vs non-whitespace ("words"). A "word"
    // here is anything between whitespace boundaries — punctuation rides
    // along with the adjacent word, which keeps fade timing natural.
    const re = /(\s+)/g;
    let cursor = 0;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(s)) !== null) {
      if (mm.index > cursor) {
        out.push({ kind: 'word', value: s.slice(cursor, mm.index) });
      }
      out.push({ kind: 'ws', value: mm[0] });
      cursor = mm.index + mm[0].length;
    }
    if (cursor < s.length) {
      out.push({ kind: 'word', value: s.slice(cursor) });
    }
  }

  while ((m = CITATION_RE.exec(raw)) !== null) {
    if (m.index > last) pushText(raw.slice(last, m.index));
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    const indexLabel = end === start ? String(start) : `${start}-${end}`;
    const citation = citations.find((c) => c.index === start);
    out.push({ kind: 'pill', indexLabel, citation });
    last = m.index + m[0].length;
  }
  if (last < raw.length) pushText(raw.slice(last));
  return out;
}

// ---------------------------------------------------------------------------
// Continuous unveil: render the full buffered answer immediately and slide a
// gradient mask downward as fast as we can without ever popping content
// in. Velocity is *adaptive* — proportional to the buffer (i.e. the pixels
// of content currently hidden under the mask). When tokens arrive in bursts
// the buffer grows and the mask accelerates to keep up; when streaming
// pauses the buffer shrinks and the mask slows to a crawl, holding the
// minimum lag so the curtain never overtakes the content edge.
// ---------------------------------------------------------------------------
// Tuning. The curtain reveals content at `velocity` px/sec, where velocity
// scales with how much content is currently hidden under the mask. We
// deliberately keep the ceiling LOW so that when a big chunk lands mid-
// stream (e.g. a paragraph all at once after a markdown marker closes)
// the curtain doesn't race across it — that's what reads as "chunk
// dumping". A lower ceiling means content sometimes sits buffered for an
// extra fraction of a second, but the fade is always smooth.
const REVEAL_MIN_VELOCITY = 60; // px/sec — slow floor when buffer is tiny
const REVEAL_MAX_VELOCITY = 180; // px/sec — perceptible ceiling, no racing
const REVEAL_VELOCITY_GAIN = 1.0; // velocity = clamp(buffer × gain)
const REVEAL_MIN_LAG_PX = 28; // smallest gap we ever leave under the curtain
const REVEAL_THRESHOLD_PX = 40; // wait until at least this much content arrives
const GRADIENT_FADE_PX = 48; // height of the soft transparent→bg edge

export function AnswerMarkdown({
  content,
  citations,
  isStreaming,
  theme,
  onCitationPress,
}: Props) {
  const processed = useMemo(() => {
    // Order matters: compress citations first so trimUnclosedMarkers sees
    // the same `[N]` shapes the renderer will, then trim, then run the
    // checkbox normaliser. Trim only kicks in while streaming — once the
    // stream is done every marker is closed.
    const compressed = compressCitations(content);
    const safe = isStreaming ? trimUnclosedMarkers(compressed) : compressed;
    return normaliseCheckboxes(safe);
  }, [content, isStreaming]);

  const mdStyles = useMemo(() => makeMarkdownStyles(theme), [theme]);

  const rules = useMemo(
    () => ({
      text: (
        node: ASTNode,
        _children: React.ReactNode[],
        _parent: ASTNode[],
        _styles: Record<string, object>,
        inheritedStyles: object = {},
      ): React.ReactNode => {
        const raw = (node as { content?: string }).content ?? '';
        const segs = tokenize(raw, citations);
        return (
          <Text key={node.key} style={inheritedStyles}>
            {segs.map((seg, i) => {
              if (seg.kind === 'ws') return seg.value;
              const key = `n-${node.key}-${i}`;
              if (seg.kind === 'pill') {
                return (
                  <CitationPill
                    key={key}
                    indexLabel={seg.indexLabel}
                    citation={seg.citation}
                    theme={theme}
                    onPress={onCitationPress}
                  />
                );
              }
              return (
                <Text key={key} style={inheritedStyles}>
                  {seg.value}
                </Text>
              );
            })}
          </Text>
        );
      },
      link: (
        node: ASTNode,
        children: React.ReactNode,
      ): React.ReactNode => {
        const href = (node as { attributes?: { href?: string } }).attributes?.href;
        return (
          <Text
            key={node.key}
            style={{ color: theme.accent, textDecorationLine: 'underline' }}
            onPress={href ? () => Linking.openURL(href) : undefined}
            suppressHighlighting
          >
            {children}
          </Text>
        );
      },
      // Wrap tables in a horizontal ScrollView so wide rows scroll instead
      // of getting crushed into unreadable wraps on narrow phone widths.
      // `TableScrollView` re-applies the user's last scrollX every time
      // its children re-render — without this, every streaming token
      // re-creates the table content, ScrollView's contentSize changes,
      // and the user's scroll snaps back to the left edge.
      table: (
        node: ASTNode,
        children: React.ReactNode,
      ): React.ReactNode => (
        <TableScrollView key={node.key} tableStyle={mdStyles.table}>
          {children}
        </TableScrollView>
      ),
    }),
    [citations, mdStyles.table, onCitationPress, theme],
  );

  // ---- Continuous unveil — mirrors the web's StreamingText -------------
  // Strategy: the wrapper's height is animated to `revealY`, with
  // overflow:hidden clipping anything beyond. Refs render as a sibling
  // below the wrapper and slide down smoothly as the wrapper's height
  // grows at the curtain's pace.
  //
  // Two defensive measures keep this stable on RN (which behaves
  // differently from the browser's ResizeObserver):
  //   1. `contentHShared` mirrors `contentH` so the worklet can gate
  //      "apply animated height" on it being >0 — without that gate,
  //      first render would set height to 0 immediately and we'd never
  //      get an unconstrained layout pass to measure.
  //   2. The inner View's onLayout is MONOTONIC: it only updates contentH
  //      when the new measurement is larger. RN children can report a
  //      shrunk frame after a parent constraint kicks in; ignoring those
  //      shrinks keeps contentH locked to the largest natural size seen.
  const [contentH, setContentH] = useState(0);
  const revealY = useSharedValue(0);
  const targetY = useSharedValue(0);
  const contentHShared = useSharedValue(0);

  useEffect(() => {
    contentHShared.value = contentH;
  }, [contentH, contentHShared]);

  useEffect(() => {
    if (contentH <= 0) return;
    if (isStreaming && contentH < REVEAL_THRESHOLD_PX) return;
    const baseTarget = isStreaming
      ? Math.max(0, contentH - REVEAL_MIN_LAG_PX)
      : contentH;
    // Strictly monotonic — a list/table reflow can briefly shrink
    // contentH and we don't want the curtain jumping up.
    if (baseTarget > targetY.value) targetY.value = baseTarget;
  }, [contentH, isStreaming, targetY]);

  useFrameCallback((info) => {
    const dt = Math.min(info.timeSincePreviousFrame ?? 16, 32);
    const buffer = targetY.value - revealY.value;
    if (buffer <= 0.5) return;
    const velocity = Math.min(
      REVEAL_MAX_VELOCITY,
      Math.max(REVEAL_MIN_VELOCITY, buffer * REVEAL_VELOCITY_GAIN),
    );
    const step = (velocity * dt) / 1000;
    revealY.value = Math.min(targetY.value, revealY.value + step);
  });

  // Animated wrapper height. Mirrors web's `height: revealY` clip — only
  // applied once we have a positive contentH, so the very first layout
  // pass can measure the natural size unconstrained.
  const wrapperHeightStyle = useAnimatedStyle(() => ({
    height: contentHShared.value > 0 ? revealY.value : undefined,
  }));

  if (!processed) {
    return null;
  }

  return (
    <Animated.View style={[styles.wrapper, wrapperHeightStyle]}>
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          // Monotonic — only grow. Once the height clip kicks in, RN may
          // report a shrunk frame; we ignore those so contentH stays
          // pinned to the largest natural size we've seen.
          if (h > contentH) setContentH(h);
        }}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Markdown style={mdStyles} rules={rules as any}>
          {processed}
        </Markdown>
      </View>
      {/* Soft fade at the bottom edge of the visible region so the
          curtain doesn't look like a hard cut. Pinned to the bottom of
          the (clipped) wrapper. */}
      <LinearGradient
        colors={[hexToRgba(theme.bg, 0), hexToRgba(theme.bg, 1)]}
        style={styles.bottomFade}
        pointerEvents="none"
      />
    </Animated.View>
  );
}

// Horizontal table scroll wrapper that *preserves the user's scrollX*
// across re-renders. The Markdown component re-renders on every streamed
// token, which calls `onContentSizeChange` on its inner ScrollView and
// (on RN) resets the visible scroll offset to 0. We track the last
// known scrollX and re-apply it whenever content size changes, which
// keeps the table where the user left it while new tokens arrive below.
function TableScrollView({
  children,
  tableStyle,
}: {
  children: React.ReactNode;
  tableStyle: object;
}) {
  const ref = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator
      style={styles.tableScroll}
      onScroll={(e) => {
        scrollXRef.current = e.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={32}
      onContentSizeChange={() => {
        if (scrollXRef.current > 0) {
          ref.current?.scrollTo({ x: scrollXRef.current, animated: false });
        }
      }}
    >
      <View style={[tableStyle, styles.tableInner]}>{children}</View>
    </ScrollView>
  );
}

// `expo-linear-gradient` accepts CSS-style color strings; we feed it
// rgba()-with-alpha so the gradient blends cleanly into the chat bg.
function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: GRADIENT_FADE_PX,
  },
  tableScroll: {
    marginVertical: 8,
  },
  tableInner: {
    minWidth: 480,
    marginVertical: 0,
  },
});


function makeMarkdownStyles(theme: Theme) {
  // The library merges these into its defaults; we override the visible
  // surface tokens so headings/lists/code adopt the brand palette.
  return StyleSheet.create({
    body: {
      color: theme.text,
      fontFamily: Fonts.sans,
      fontSize: 15,
      lineHeight: 23,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 10,
    },
    heading1: {
      fontFamily: Fonts.sansBold,
      fontSize: 22,
      lineHeight: 28,
      color: theme.text,
      marginTop: 12,
      marginBottom: 8,
      letterSpacing: -0.3,
    },
    heading2: {
      fontFamily: Fonts.sansBold,
      fontSize: 18,
      lineHeight: 24,
      color: theme.text,
      marginTop: 12,
      marginBottom: 6,
      letterSpacing: -0.2,
    },
    heading3: {
      fontFamily: Fonts.sansBold,
      fontSize: 16,
      lineHeight: 22,
      color: theme.text,
      marginTop: 10,
      marginBottom: 6,
    },
    heading4: {
      fontFamily: Fonts.sansBold,
      fontSize: 14,
      color: theme.text,
      marginTop: 8,
      marginBottom: 4,
    },
    strong: {
      fontFamily: Fonts.sansBold,
      color: theme.text,
    },
    em: {
      fontStyle: 'italic',
    },
    s: {
      textDecorationLine: 'line-through',
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: theme.accent,
      backgroundColor: theme.accentSoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginVertical: 8,
      borderRadius: 6,
    },
    bullet_list: {
      marginTop: 4,
      marginBottom: 8,
    },
    ordered_list: {
      marginTop: 4,
      marginBottom: 8,
    },
    list_item: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    bullet_list_icon: {
      color: theme.accent,
      marginLeft: 4,
      marginRight: 8,
      lineHeight: 23,
    },
    ordered_list_icon: {
      color: theme.accent,
      fontFamily: Fonts.sansMedium,
      marginLeft: 0,
      marginRight: 8,
      lineHeight: 23,
    },
    code_inline: {
      fontFamily: Fonts.sansMedium,
      fontSize: 13,
      color: theme.accent,
      backgroundColor: theme.accentSoft,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    code_block: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.text,
      backgroundColor: theme.elevated,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
    },
    fence: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.text,
      backgroundColor: theme.elevated,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
    },
    hr: {
      backgroundColor: theme.border,
      height: 1,
      marginVertical: 12,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      marginVertical: 8,
    },
    thead: {
      backgroundColor: theme.elevated,
    },
    tr: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    th: {
      padding: 8,
      fontFamily: Fonts.sansBold,
      color: theme.text,
    },
    td: {
      padding: 8,
      color: theme.text,
    },
    link: {
      color: theme.accent,
      textDecorationLine: 'underline',
    },
  });
}
