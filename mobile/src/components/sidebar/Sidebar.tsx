import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MessageSquare, Trash2, Sun, Moon } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { tapHaptic } from '@/lib/haptics';
import { useChat } from '@/contexts/ChatContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import type { Conversation } from '@/types';

const { width: SCREEN_W } = Dimensions.get('window');
const SIDEBAR_W = Math.round(SCREEN_W * 0.78);

interface SidebarProps {
  onItemPress: () => void;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day && date.getDate() === now.getDate()) return 'Today';
  if (diffMs < 2 * day) return 'Yesterday';
  if (diffMs < 7 * day) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupConversations(items: Conversation[]) {
  // Backend already returns conversations sorted by updated_at desc.
  // No additional grouping for now — simple flat list reads cleanly on mobile.
  return items;
}

export function Sidebar({ onItemPress }: SidebarProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const {
    conversations,
    conversationsLoading,
    conversationId,
    loadConversation,
    newChat,
    deleteConversationById,
  } = useChat();
  const themeMode = useThemeMode();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function handleThemeToggle() {
    tapHaptic();
    themeMode.toggle();
  }

  function handleNewChat() {
    tapHaptic();
    newChat();
    onItemPress();
  }

  async function handleConversationPress(id: string) {
    tapHaptic();
    onItemPress();
    if (id !== conversationId) {
      await loadConversation(id);
    }
  }

  function handleDeletePress(c: Conversation) {
    tapHaptic();
    Alert.alert(
      'Delete chat',
      `Delete "${c.title ?? 'Untitled chat'}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setPendingDeleteId(c.id);
            await deleteConversationById(c.id);
            setPendingDeleteId(null);
          },
        },
      ],
    );
  }

  const list = groupConversations(conversations);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — logo + theme toggle + (decorative) search row */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Image
              source={
                theme.scheme === 'dark'
                  ? require('../../../assets/logo-for-dark-bg.png')
                  : require('../../../assets/logo-for-light-bg.png')
              }
              style={styles.brandLogo}
              resizeMode="contain"
            />
            <TouchableOpacity
              style={styles.themeToggle}
              onPress={handleThemeToggle}
              activeOpacity={0.7}
              accessibilityLabel={
                theme.scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
            >
              {theme.scheme === 'dark' ? (
                <Sun size={16} color={theme.text} />
              ) : (
                <Moon size={16} color={theme.text} />
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <Search size={15} color={theme.textSecondary} />
              <Text style={styles.searchPlaceholder}>Search chats</Text>
            </View>
          </View>
        </View>

        {/* Primary action — new chat */}
        <View style={styles.navSection}>
          <TouchableOpacity
            style={[styles.navItem, styles.navItemActive]}
            onPress={handleNewChat}
            activeOpacity={0.7}
          >
            <MessageSquare size={18} color={theme.accent} />
            <Text style={[styles.navLabel, styles.navLabelActive]}>New chat</Text>
          </TouchableOpacity>
        </View>

        {/* Conversations */}
        <View style={styles.sectionLabelWrap}>
          <Text style={styles.sectionLabel}>Recents</Text>
        </View>
        <View style={styles.itemList}>
          {conversationsLoading && list.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.textMuted} size="small" />
            </View>
          ) : list.length === 0 ? (
            <Text style={styles.emptyText}>
              No chats yet. Ask your first clinical question.
            </Text>
          ) : (
            list.map((c) => {
              const isActive = c.id === conversationId;
              const isDeleting = pendingDeleteId === c.id;
              return (
                <View
                  key={c.id}
                  style={[
                    styles.recentItem,
                    isActive && styles.recentItemActive,
                    isDeleting && styles.recentItemDeleting,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.recentMain}
                    onPress={() => handleConversationPress(c.id)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.recentLabel,
                        isActive && styles.recentLabelActive,
                      ]}
                      numberOfLines={1}
                    >
                      {c.title ?? 'Untitled chat'}
                    </Text>
                    <Text style={styles.recentTimestamp}>
                      {formatRelative(c.updated_at)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeletePress(c)}
                    style={styles.deleteButton}
                    hitSlop={{ top: 10, right: 8, bottom: 10, left: 8 }}
                    activeOpacity={0.6}
                  >
                    <Trash2 size={14} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: {
      width: SIDEBAR_W,
      flex: 1,
      backgroundColor: theme.elevated,
    },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 24 },

    header: {
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 14,
    },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    brandLogo: {
      width: 141,
      height: 32,
    },
    themeToggle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    searchField: {
      flex: 1,
      height: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      backgroundColor: theme.surface,
      borderRadius: 100,
    },
    searchPlaceholder: {
      fontFamily: Fonts.sansMedium,
      fontSize: 14,
      color: theme.textMuted,
      letterSpacing: -0.07,
    },

    navSection: {
      paddingHorizontal: 12,
      gap: 2,
    },
    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: 12,
    },
    navItemActive: {
      backgroundColor: theme.accentSoft,
    },
    navLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 15,
      color: theme.text,
      letterSpacing: -0.07,
    },
    navLabelActive: {
      fontFamily: Fonts.sansBold,
      color: theme.accent,
    },

    sectionLabelWrap: {
      paddingHorizontal: 24,
      paddingTop: 20,
      paddingBottom: 6,
    },
    sectionLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.textMuted,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },

    itemList: { paddingHorizontal: 12 },
    loadingRow: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    emptyText: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
      lineHeight: 18,
    },
    recentItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingRight: 4,
      borderRadius: 10,
    },
    recentItemActive: {
      backgroundColor: theme.accentSoft,
    },
    recentItemDeleting: {
      opacity: 0.5,
    },
    recentMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
    },
    recentLabel: {
      flex: 1,
      fontFamily: Fonts.sansMedium,
      fontSize: 14,
      color: theme.text,
      letterSpacing: -0.07,
    },
    recentLabelActive: {
      fontFamily: Fonts.sansBold,
      color: theme.accent,
    },
    recentTimestamp: {
      fontFamily: Fonts.sansMedium,
      fontSize: 11,
      color: theme.textMuted,
      flexShrink: 0,
    },
    deleteButton: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
