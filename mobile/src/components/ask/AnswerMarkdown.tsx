// Streaming markdown renderer for assistant answers — mirrors the web's
// StreamingText component (frontend/components/StreamingText.tsx) at a
// React Native level: gradual character drain decouples bursty token
// delivery from render cadence, citation runs are compressed and rendered
// as inline accent-tinted pills, and the rest of the markdown is rendered
// via react-native-markdown-display with theme-aware styles.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Markdown, { type ASTNode } from 'react-native-markdown-display';
import { Fonts } from '@/constants';
import type { Citation } from '@/types';
import type { Theme } from '@/hooks/useTheme';

interface Props {
  content: string;
  citations: Citation[];
  isStreaming: boolean;
  theme: Theme;
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

// Mirrors frontend/components/StreamingText.tsx#abbreviateCitation — turns
// publisher + year into a short label like "WHO 2024".
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

function CitationPill({
  indexLabel,
  citation,
  theme,
}: {
  indexLabel: string;
  citation?: Citation;
  theme: Theme;
}) {
  const styles = makePillStyles(theme);
  // Inline pill — solid translucent accent with the number + publisher
  // acronym side by side, e.g. "1 WHO 2024". The wrapping Text inherits
  // the surrounding paragraph baseline so it sits on the line.
  const sub = citation ? abbreviateCitation(citation) : null;
  return (
    <Text
      style={styles.pill}
      onPress={
        citation?.source_url ? () => Linking.openURL(citation.source_url!) : undefined
      }
      suppressHighlighting
    >
      <Text style={styles.pillIndex}>{indexLabel}</Text>
      {sub ? <Text style={styles.pillLabel}>{` ${sub}`}</Text> : null}
    </Text>
  );
}

function makePillStyles(theme: Theme) {
  return StyleSheet.create({
    pill: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.accent,
      backgroundColor: theme.pillBg,
      borderRadius: 999,
      overflow: 'hidden',
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    pillIndex: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.accent,
      opacity: 0.6,
    },
    pillLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.accent,
      letterSpacing: -0.05,
    },
  });
}

// Take a raw string fragment (from the markdown text node) and split it into
// alternating plain-text and citation-pill nodes.
function renderTextWithCitations(
  raw: string,
  citations: Citation[],
  theme: Theme,
  baseStyle: object,
): React.ReactNode {
  if (!raw.includes('[')) return raw;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(raw)) !== null) {
    if (m.index > last) {
      out.push(<Text key={`t-${last}`} style={baseStyle}>{raw.slice(last, m.index)}</Text>);
    }
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    const indexLabel = end === start ? String(start) : `${start}-${end}`;
    const cite = citations.find((c) => c.index === start);
    out.push(
      <CitationPill
        key={`c-${m.index}`}
        indexLabel={indexLabel}
        citation={cite}
        theme={theme}
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    out.push(<Text key={`t-${last}`} style={baseStyle}>{raw.slice(last)}</Text>);
  }
  return <>{out}</>;
}

export function AnswerMarkdown({ content, citations, isStreaming, theme }: Props) {
  // ---- Smooth character drain (matches web) -------------------------------
  const targetRef = useRef('');
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    targetRef.current = content;
    if (!isStreaming) setDisplayed(content);
  }, [content, isStreaming]);

  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => {
      setDisplayed((prev) => {
        const target = targetRef.current;
        if (prev.length >= target.length) return prev;
        const queued = target.length - prev.length;
        const n = queued > 200 ? 18 : queued > 80 ? 7 : 3;
        return target.slice(0, prev.length + n);
      });
    }, 16);
    return () => clearInterval(id);
  }, [isStreaming]);

  const processed = useMemo(() => {
    return normaliseCheckboxes(compressCitations(displayed));
  }, [displayed]);

  const mdStyles = useMemo(() => makeMarkdownStyles(theme), [theme]);

  // Custom rules: override the text renderer so we can splice citation pills
  // into the inline text stream. The library passes us the raw node content
  // and inherited styles; we return a Text fragment with mixed children.
  const rules = useMemo(
    () => ({
      text: (
        node: ASTNode,
        _children: React.ReactNode[],
        _parent: ASTNode[],
        _styles: Record<string, object>,
        inheritedStyles: object = {},
      ): React.ReactNode => {
        const content = (node as { content?: string }).content ?? '';
        const baseStyle = { ...inheritedStyles };
        return (
          <Text key={node.key} style={baseStyle}>
            {renderTextWithCitations(content, citations, theme, baseStyle)}
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
    }),
    [citations, theme],
  );

  if (!displayed) {
    return null;
  }

  return (
    <View>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Markdown style={mdStyles} rules={rules as any}>
        {processed}
      </Markdown>
    </View>
  );
}

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
