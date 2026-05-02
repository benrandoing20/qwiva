import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Heart, BadgeCheck, Send } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import {
  createComment,
  fetchComments,
  toggleCommentLike,
  togglePostLike,
} from '@/lib/api';
import { tapHaptic, errorHaptic, successHaptic } from '@/lib/haptics';
import type { Comment, Post } from '@/types';

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
  post: Post | null;
  token: string;
  onClose: () => void;
  // Bubble updated post counts (likes / comments) up so the source list
  // stays in sync without a refetch.
  onPostUpdate: (updated: Post) => void;
}

export function PostDetailModal({ post, token, onClose, onPostUpdate }: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const visible = post !== null;

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track local like state so the heart in the modal updates instantly.
  const [liked, setLiked] = useState(post?.viewer_liked ?? false);
  const [likeCount, setLikeCount] = useState(post?.like_count ?? 0);
  const [likeBusy, setLikeBusy] = useState(false);

  // Load comments + reset local state every time a new post is opened.
  useEffect(() => {
    if (!post) {
      setComments([]);
      setDraft('');
      setError(null);
      return;
    }
    setLiked(post.viewer_liked);
    setLikeCount(post.like_count);
    setLoading(true);
    fetchComments(post.id, token)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [post, token]);

  async function handleLike() {
    if (!post || likeBusy) return;
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
      onPostUpdate({ ...post, viewer_liked: r.liked, like_count: r.like_count });
    } catch {
      setLiked(wasLiked);
      setLikeCount(wasCount);
    } finally {
      setLikeBusy(false);
    }
  }

  async function handleSubmit() {
    if (!post || !draft.trim() || submitting) return;
    tapHaptic();
    setSubmitting(true);
    setError(null);
    try {
      const c = await createComment(
        post.id,
        { content: draft.trim(), is_anonymous: false },
        token,
      );
      successHaptic();
      setComments((prev) => [...prev, c]);
      setDraft('');
      onPostUpdate({ ...post, comment_count: post.comment_count + 1 });
    } catch (err) {
      errorHaptic();
      setError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      {post ? (
        <View style={styles.root}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <X size={22} color={theme.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Post</Text>
            <View style={styles.headerSpacer} />
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
              {/* Post header */}
              <View style={styles.authorRow}>
                <View style={styles.avatar}>
                  {post.author_avatar ? (
                    <Image
                      source={{ uri: post.author_avatar }}
                      style={styles.avatarImage}
                    />
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
                      <BadgeCheck size={14} color={theme.accent} />
                    )}
                  </View>
                  <Text style={styles.authorSub} numberOfLines={1}>
                    {[post.author_specialty, timeAgo(post.created_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>

              {/* Content */}
              <Text style={styles.postContent}>{post.content}</Text>

              {/* Tags */}
              {post.tags.length > 0 && (
                <View style={styles.tagsRow}>
                  {post.tags.map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagText}>#{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Like row */}
              <View style={styles.likeRow}>
                <TouchableOpacity
                  onPress={handleLike}
                  disabled={likeBusy}
                  activeOpacity={0.7}
                  style={styles.likeButton}
                  hitSlop={6}
                >
                  <Heart
                    size={16}
                    color={liked ? theme.accent : theme.textMuted}
                    fill={liked ? theme.accent : 'transparent'}
                  />
                  <Text
                    style={[
                      styles.likeCount,
                      liked && { color: theme.accent },
                    ]}
                  >
                    {likeCount}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Comments header */}
              <View style={styles.commentsHeader}>
                <Text style={styles.commentsTitle}>
                  {comments.length === 1
                    ? '1 comment'
                    : `${comments.length} comments`}
                </Text>
              </View>

              {/* Comment list */}
              {loading ? (
                <View style={styles.commentLoading}>
                  <ActivityIndicator size="small" color={theme.textMuted} />
                </View>
              ) : comments.length === 0 ? (
                <Text style={styles.commentEmpty}>
                  No comments yet — be the first to weigh in.
                </Text>
              ) : (
                comments.map((c) => (
                  <CommentRow
                    key={c.id}
                    comment={c}
                    token={token}
                    theme={theme}
                  />
                ))
              )}
            </ScrollView>

            {/* Composer */}
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment…"
                placeholderTextColor={theme.textMuted}
                style={styles.composerInput}
                multiline
                maxLength={2000}
              />
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!draft.trim() || submitting}
                style={[
                  styles.composerSend,
                  (!draft.trim() || submitting) && styles.composerSendDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Send size={16} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </KeyboardAvoidingView>
        </View>
      ) : null}
    </Modal>
  );
}

function CommentRow({
  comment,
  token,
  theme,
}: {
  comment: Comment;
  token: string;
  theme: Theme;
}) {
  const styles = makeStyles(theme);
  const [liked, setLiked] = useState(comment.viewer_liked);
  const [likeCount, setLikeCount] = useState(comment.like_count);
  const [busy, setBusy] = useState(false);

  async function handleLike() {
    if (busy) return;
    tapHaptic();
    setBusy(true);
    const wasLiked = liked;
    const wasCount = likeCount;
    setLiked(!wasLiked);
    setLikeCount(wasCount + (wasLiked ? -1 : 1));
    try {
      const r = await toggleCommentLike(comment.id, token);
      setLiked(r.liked);
      setLikeCount(r.like_count);
    } catch {
      setLiked(wasLiked);
      setLikeCount(wasCount);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.commentRow}>
      <View style={styles.commentAvatar}>
        {comment.author_avatar ? (
          <Image
            source={{ uri: comment.author_avatar }}
            style={styles.avatarImage}
          />
        ) : (
          <Text style={styles.commentAvatarInitial}>
            {comment.author_name.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={styles.commentBody}>
        <View style={styles.commentNameRow}>
          <Text style={styles.commentName} numberOfLines={1}>
            {comment.author_name}
          </Text>
          {comment.author_verified === 'verified' && (
            <BadgeCheck size={11} color={theme.accent} />
          )}
          <Text style={styles.commentTime}>
            · {timeAgo(comment.created_at)}
          </Text>
        </View>
        <Text style={styles.commentText}>{comment.content}</Text>
        <TouchableOpacity
          onPress={handleLike}
          disabled={busy}
          activeOpacity={0.7}
          style={styles.commentLikeRow}
          hitSlop={6}
        >
          <Heart
            size={12}
            color={liked ? theme.accent : theme.textMuted}
            fill={liked ? theme.accent : 'transparent'}
          />
          <Text
            style={[
              styles.commentLikeText,
              liked && { color: theme.accent },
            ]}
          >
            {likeCount > 0 ? likeCount : 'Like'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
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
    headerSpacer: {
      width: 22,
    },
    body: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 24,
      gap: 14,
    },

    // Post body
    authorRow: {
      flexDirection: 'row',
      gap: 10,
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
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
      fontSize: 14,
      color: theme.accent,
    },
    authorMeta: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
    },
    authorNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    authorName: {
      fontFamily: Fonts.sansBold,
      fontSize: 14,
      color: theme.text,
      flexShrink: 1,
    },
    authorSub: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.textMuted,
      marginTop: 1,
    },
    postContent: {
      fontFamily: Fonts.sans,
      fontSize: 15,
      color: theme.text,
      lineHeight: 22,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    tag: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
    },
    tagText: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    likeRow: {
      flexDirection: 'row',
      paddingTop: 6,
      paddingBottom: 4,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    likeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    likeCount: {
      fontFamily: Fonts.sansMedium,
      fontSize: 13,
      color: theme.textMuted,
    },

    // Comments
    commentsHeader: {
      paddingTop: 4,
    },
    commentsTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: theme.textMuted,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    commentLoading: {
      paddingVertical: 12,
    },
    commentEmpty: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
      paddingVertical: 8,
    },
    commentRow: {
      flexDirection: 'row',
      gap: 10,
    },
    commentAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    commentAvatarInitial: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.accent,
    },
    commentBody: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    commentNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    commentName: {
      fontFamily: Fonts.sansBold,
      fontSize: 12,
      color: theme.text,
      flexShrink: 1,
    },
    commentTime: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    commentText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.text,
      lineHeight: 19,
    },
    commentLikeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    commentLikeText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 11,
      color: theme.textMuted,
    },

    // Composer
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 28 : 14,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.bg,
    },
    composerInput: {
      flex: 1,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 40,
      maxHeight: 120,
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.text,
      lineHeight: 19,
      textAlignVertical: 'center',
    },
    composerSend: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composerSendDisabled: {
      opacity: 0.4,
    },

    errorBox: {
      backgroundColor: theme.dangerWash,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 12,
      padding: 10,
      marginHorizontal: 12,
      marginBottom: 8,
    },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.danger,
    },
  });
}
