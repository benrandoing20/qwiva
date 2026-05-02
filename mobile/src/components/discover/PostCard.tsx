import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { Heart, MessageCircle, BadgeCheck } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { togglePostLike } from '@/lib/api';
import type { Post, PostType } from '@/types';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { tapHaptic } from '@/lib/haptics';

const POST_TYPE_LABEL: Record<PostType, string> = {
  question: 'Question',
  case_discussion: 'Case',
  clinical_pearl: 'Pearl',
  resource: 'Resource',
};

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString();
}

interface Props {
  post: Post;
  token: string;
  onUpdate?: (updated: Post) => void;
  onOpen?: (post: Post) => void;
}

export function PostCard({ post, token, onUpdate, onOpen }: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [liked, setLiked] = useState(post.viewer_liked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [likeBusy, setLikeBusy] = useState(false);

  // Sync local optimistic state when the parent supplies a fresh post.
  useEffect(() => {
    setLiked(post.viewer_liked);
    setLikeCount(post.like_count);
  }, [post.id, post.viewer_liked, post.like_count]);

  async function handleLike() {
    if (likeBusy) return;
    tapHaptic();
    setLikeBusy(true);
    const wasLiked = liked;
    const wasCount = likeCount;
    setLiked(!wasLiked);
    setLikeCount(wasCount + (wasLiked ? -1 : 1));
    try {
      const r = await togglePostLike(post.id, token);
      setLiked(r.liked);
      setLikeCount(r.like_count);
      onUpdate?.({ ...post, viewer_liked: r.liked, like_count: r.like_count });
    } catch {
      setLiked(wasLiked);
      setLikeCount(wasCount);
    } finally {
      setLikeBusy(false);
    }
  }

  const typeLabel = POST_TYPE_LABEL[post.post_type] ?? post.post_type;

  function handleOpen() {
    if (!onOpen) return;
    tapHaptic();
    onOpen(post);
  }

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={onOpen ? 0.85 : 1}
      onPress={onOpen ? handleOpen : undefined}
      disabled={!onOpen}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.authorRow}>
          <View style={styles.avatar}>
            {post.author_avatar ? (
              <Image source={{ uri: post.author_avatar }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitial}>
                {post.author_name.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={styles.authorMeta}>
            <View style={styles.authorNameRow}>
              <Text style={styles.authorName} numberOfLines={1}>
                {post.author_name}
              </Text>
              {post.author_verified === 'verified' && (
                <BadgeCheck size={12} color={theme.accent} />
              )}
            </View>
            <Text style={styles.authorSub} numberOfLines={1}>
              {[post.author_specialty, timeAgo(post.created_at)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        <View style={styles.typePill}>
          <Text style={styles.typePillText}>{typeLabel}</Text>
        </View>
      </View>

      {/* Content */}
      <Text style={styles.content} numberOfLines={6}>
        {post.content}
      </Text>

      {/* Tags */}
      {post.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {post.tags.slice(0, 4).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleLike}
          disabled={likeBusy}
          activeOpacity={0.7}
          style={styles.footerAction}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Heart
            size={14}
            color={liked ? theme.accent : theme.textMuted}
            fill={liked ? theme.accent : 'transparent'}
          />
          <Text style={[styles.footerCount, liked && { color: theme.accent }]}>
            {likeCount}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onOpen ? handleOpen : undefined}
          disabled={!onOpen}
          activeOpacity={0.7}
          style={styles.footerAction}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <MessageCircle size={14} color={theme.textMuted} />
          <Text style={styles.footerCount}>{post.comment_count}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      width: 300,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      padding: 14,
      gap: 10,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },
    authorRow: {
      flexDirection: 'row',
      gap: 10,
      flex: 1,
      minWidth: 0,
    },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarInitial: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.accent,
    },
    authorMeta: {
      flex: 1,
      minWidth: 0,
    },
    authorNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    authorName: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.text,
      flexShrink: 1,
    },
    authorSub: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
      marginTop: 1,
    },
    typePill: {
      backgroundColor: theme.pillBg,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
    },
    typePillText: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.accent,
      letterSpacing: 0.2,
    },
    content: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.text,
      lineHeight: 19,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
    },
    tag: {
      paddingHorizontal: 7,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
    },
    tagText: {
      fontFamily: Fonts.sans,
      fontSize: 10,
      color: theme.textMuted,
    },
    footer: {
      flexDirection: 'row',
      gap: 16,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    footerAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    footerCount: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
  });
}
