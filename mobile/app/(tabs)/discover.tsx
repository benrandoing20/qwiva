import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { fetchFeed, getAccessToken } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { tapHaptic } from '@/lib/haptics';
import type { Post } from '@/types';
import { HScrollSection } from '@/components/discover/HScrollSection';
import { PostComposer } from '@/components/discover/PostComposer';
import { PostDetailModal } from '@/components/discover/PostDetailModal';

const SPECIALTIES = [
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

export default function DiscoverScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [followingPosts, setFollowingPosts] = useState<Post[]>([]);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [loadingFollowing, setLoadingFollowing] = useState(true);
  const [loadingAll, setLoadingAll] = useState(true);
  const [selectedSpecialty, setSelectedSpecialty] = useState(SPECIALTIES[0]);
  const [composing, setComposing] = useState(false);
  const [activePost, setActivePost] = useState<Post | null>(null);

  // Auth + token + default specialty (mirrors web /discover behaviour).
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

      const { data } = await supabase
        .from('user_profiles')
        .select('specialty')
        .single();
      if (cancelled) return;
      const userSpecialty = data?.specialty as string | undefined;
      if (userSpecialty && SPECIALTIES.includes(userSpecialty)) {
        setSelectedSpecialty(userSpecialty);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Pull both feeds in parallel once we have a token.
  useEffect(() => {
    if (!token) return;
    setLoadingFollowing(true);
    setLoadingAll(true);
    fetchFeed(token, null, 'following', 30)
      .then(setFollowingPosts)
      .catch(() => undefined)
      .finally(() => setLoadingFollowing(false));
    // Pull a larger batch so the specialty buckets aren't sparse — we
    // filter client-side until a /feed?specialty= endpoint exists.
    fetchFeed(token, null, 'all', 50)
      .then(setAllPosts)
      .catch(() => undefined)
      .finally(() => setLoadingAll(false));
  }, [token]);

  const specialtyPosts = useMemo(
    () => allPosts.filter((p) => p.specialty_tags.includes(selectedSpecialty)),
    [allPosts, selectedSpecialty],
  );

  const handlePostUpdate = useCallback((updated: Post) => {
    const merge = (list: Post[]) =>
      list.map((p) => (p.id === updated.id ? updated : p));
    setFollowingPosts(merge);
    setAllPosts(merge);
    // Keep the open detail modal in sync if it's showing this same post.
    setActivePost((prev) => (prev?.id === updated.id ? updated : prev));
  }, []);

  const handleNewPost = useCallback((post: Post) => {
    setComposing(false);
    setAllPosts((prev) => [post, ...prev]);
  }, []);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
        <TouchableOpacity
          onPress={() => {
            tapHaptic();
            setComposing(true);
          }}
          style={styles.postButton}
          activeOpacity={0.85}
        >
          <Plus size={16} color="#FFFFFF" />
          <Text style={styles.postButtonText}>Post</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <HScrollSection
          title="From people you follow"
          emptyText="Follow physicians to see their posts here."
          loading={loadingFollowing}
          posts={followingPosts}
          token={token ?? ''}
          onUpdate={handlePostUpdate}
          onOpen={setActivePost}
        />

        <View style={styles.sectionGap} />

        <HScrollSection
          title="Browse by specialty"
          emptyText={`No recent posts tagged ${selectedSpecialty}.`}
          loading={loadingAll}
          posts={specialtyPosts}
          token={token ?? ''}
          onUpdate={handlePostUpdate}
          onOpen={setActivePost}
        />

        {/* Specialty picker — horizontal pill row instead of a native
            <select>; phones don't have a clean inline dropdown affordance. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.specialtyRow}
          style={styles.specialtyScroll}
        >
          {SPECIALTIES.map((s) => {
            const active = s === selectedSpecialty;
            return (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  tapHaptic();
                  setSelectedSpecialty(s);
                }}
                style={[styles.specialtyPill, active && styles.specialtyPillActive]}
              >
                <Text
                  style={[
                    styles.specialtyText,
                    active && styles.specialtyTextActive,
                  ]}
                >
                  {s}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </ScrollView>

      {token && (
        <PostComposer
          visible={composing}
          token={token}
          onPost={handleNewPost}
          onClose={() => setComposing(false)}
        />
      )}

      {token && (
        <PostDetailModal
          post={activePost}
          token={token}
          onClose={() => setActivePost(null)}
          onPostUpdate={handlePostUpdate}
        />
      )}
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
      paddingTop: 60,
      paddingBottom: 12,
    },
    title: {
      fontFamily: Fonts.sansBold,
      fontSize: 22,
      color: theme.text,
      letterSpacing: -0.3,
    },
    postButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: theme.accent,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
    },
    postButtonText: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: '#FFFFFF',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingTop: 8,
      paddingBottom: 120,
    },
    sectionGap: {
      height: 22,
    },
    specialtyScroll: {
      marginTop: 10,
    },
    specialtyRow: {
      paddingHorizontal: 16,
      gap: 6,
    },
    specialtyPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    specialtyPillActive: {
      backgroundColor: theme.pillBg,
      borderColor: theme.accent,
    },
    specialtyText: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    specialtyTextActive: {
      color: theme.accent,
      fontFamily: Fonts.sansBold,
    },
  });
}
