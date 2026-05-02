import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Fonts } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { fetchSurveys, fetchMyProfile, getAccessToken } from '@/lib/api';
import { tapHaptic } from '@/lib/haptics';
import type { Survey } from '@/types';

export default function SurveysScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

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
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchSurveys(token), fetchMyProfile(token)])
      .then(([surveyList, profile]) => {
        if (cancelled) return;
        setSurveys(surveyList);
        setIsAdmin(profile?.role === 'admin');
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const activeSurveys = surveys.filter((s) => s.status === 'active');
  const myDrafts = surveys.filter((s) => s.status === 'draft');
  const closedSurveys = surveys.filter((s) => s.status === 'closed');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Surveys</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={theme.textMuted} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {activeSurveys.length === 0 &&
          myDrafts.length === 0 &&
          closedSurveys.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No surveys available</Text>
              <Text style={styles.emptyBody}>
                Check back soon for new surveys.
              </Text>
            </View>
          ) : null}

          {activeSurveys.length > 0 && (
            <View style={styles.section}>
              {activeSurveys.map((s) => (
                <SurveyCard
                  key={s.id}
                  survey={s}
                  theme={theme}
                  onPress={() => {
                    tapHaptic();
                    router.push(`/surveys/${s.id}`);
                  }}
                />
              ))}
            </View>
          )}

          {isAdmin && myDrafts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>My drafts</Text>
              {myDrafts.map((s) => (
                <SurveyCard key={s.id} survey={s} theme={theme} />
              ))}
            </View>
          )}

          {isAdmin && closedSurveys.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Closed</Text>
              {closedSurveys.map((s) => (
                <SurveyCard key={s.id} survey={s} theme={theme} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SurveyCard({
  survey,
  theme,
  onPress,
}: {
  survey: Survey;
  theme: Theme;
  onPress?: () => void;
}) {
  const styles = makeStyles(theme);
  const isActive = survey.status === 'active';
  const isDraft = survey.status === 'draft';
  const tappable = isActive && !survey.has_responded && !!onPress;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={tappable ? 0.85 : 1}
      onPress={tappable ? onPress : undefined}
      disabled={!tappable}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.cardTagsRow}>
          {(isDraft || survey.status === 'closed') && (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>
                {isDraft ? 'Draft' : 'Closed'}
              </Text>
            </View>
          )}
          {survey.specialty_tags.slice(0, 2).map((tag) => (
            <View key={tag} style={styles.specialtyPill}>
              <Text style={styles.specialtyPillText} numberOfLines={1}>
                {tag}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {survey.title}
      </Text>
      {survey.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {survey.description}
        </Text>
      ) : null}

      <View style={styles.cardMetaRow}>
        {survey.estimated_minutes ? (
          <Text style={styles.cardMeta}>{survey.estimated_minutes} min</Text>
        ) : null}
        <Text style={styles.cardMeta}>
          {survey.response_count}{' '}
          {survey.response_count === 1 ? 'response' : 'responses'}
        </Text>
      </View>

      <View style={styles.cardFooter}>
        {survey.has_responded ? (
          <View style={styles.respondedPill}>
            <Text style={styles.respondedPillText}>Responded</Text>
          </View>
        ) : isActive ? (
          <View style={styles.takeButton}>
            <Text style={styles.takeButtonText}>Take Survey</Text>
            <ChevronRight size={16} color="#FFFFFF" />
          </View>
        ) : (
          <View style={styles.respondedPill}>
            <Text style={styles.respondedPillText}>
              {isDraft ? 'Draft' : 'Closed'}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
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
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { flex: 1 },
    scrollContent: {
      padding: 16,
      paddingBottom: 120,
      gap: 18,
    },
    section: {
      gap: 12,
    },
    sectionLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.textMuted,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      marginBottom: 2,
    },

    empty: {
      paddingVertical: 64,
      alignItems: 'center',
      gap: 4,
    },
    emptyTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 15,
      color: theme.text,
    },
    emptyBody: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
    },

    card: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      padding: 16,
      gap: 8,
    },
    cardTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    cardTagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      flex: 1,
    },
    statusPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      backgroundColor: theme.elevated,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
    },
    statusPillText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 10,
      color: theme.textMuted,
    },
    specialtyPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      backgroundColor: theme.pillBg,
      borderRadius: 999,
      maxWidth: 200,
    },
    specialtyPillText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 10,
      color: theme.accent,
    },
    cardTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 15,
      color: theme.text,
      lineHeight: 20,
    },
    cardDescription: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textMuted,
      lineHeight: 18,
    },
    cardMetaRow: {
      flexDirection: 'row',
      gap: 12,
    },
    cardMeta: {
      fontFamily: Fonts.sans,
      fontSize: 11,
      color: theme.textMuted,
    },
    cardFooter: {
      marginTop: 4,
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    respondedPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.elevated,
    },
    respondedPillText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      color: theme.textMuted,
    },
    takeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.accent,
      paddingLeft: 14,
      paddingRight: 10,
      paddingVertical: 8,
      borderRadius: 999,
    },
    takeButtonText: {
      fontFamily: Fonts.sansBold,
      fontSize: 13,
      color: '#FFFFFF',
    },
  });
}
