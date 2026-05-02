import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import type { Post } from '@/types';
import { PostCard } from './PostCard';

interface Props {
  title: string;
  emptyText: string;
  loading: boolean;
  posts: Post[];
  token: string;
  onUpdate: (updated: Post) => void;
  onOpen: (post: Post) => void;
  rightSlot?: React.ReactNode;
}

export function HScrollSection({
  title,
  emptyText,
  loading,
  posts,
  token,
  onUpdate,
  onOpen,
  rightSlot,
}: Props) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {rightSlot}
      </View>

      {loading ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </ScrollView>
      ) : posts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          decelerationRate="fast"
          snapToInterval={300 + 12}
          snapToAlignment="start"
        >
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              token={token}
              onUpdate={onUpdate}
              onOpen={onOpen}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    section: {
      gap: 10,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
    },
    title: {
      fontFamily: Fonts.sansBold,
      fontSize: 16,
      color: theme.text,
      flex: 1,
    },
    row: {
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 4,
    },
    skeleton: {
      width: 300,
      height: 220,
      borderRadius: 18,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      opacity: 0.6,
    },
    empty: {
      marginHorizontal: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      paddingVertical: 28,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    emptyText: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
      textAlign: 'center',
    },
  });
}
