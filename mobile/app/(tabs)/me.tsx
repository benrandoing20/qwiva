import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Pencil, X, ShieldCheck } from 'lucide-react-native';
import { Fonts, FontSizes, Spacing, Radii } from '@/constants';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { fetchMyProfile, updateProfile, getAccessToken } from '@/lib/api';
import { tapHaptic, successHaptic, errorHaptic } from '@/lib/haptics';
import type { PhysicianProfile } from '@/types';

type FormState = {
  display_name: string;
  first_name: string;
  last_name: string;
  bio: string;
  phone: string;
  country: string;
  city: string;
  institution: string;
  years_experience: string;
  avatar_url: string;
  specialties: string;
  languages: string;
  interests: string;
};

function toForm(p: PhysicianProfile): FormState {
  return {
    display_name: p.display_name ?? '',
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    bio: p.bio ?? '',
    phone: p.phone ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    institution: p.institution ?? '',
    years_experience: p.years_experience != null ? String(p.years_experience) : '',
    avatar_url: p.avatar_url ?? '',
    specialties: (p.specialties ?? []).join(', '),
    languages: (p.languages ?? []).join(', '),
    interests: (p.interests ?? []).join(', '),
  };
}

function splitList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function ProfileScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [profile, setProfile] = useState<PhysicianProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        setProfile(null);
        return;
      }
      const data = await fetchMyProfile(token);
      setProfile(data);
    } catch {
      // Soft-fail; the screen renders the empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSignOut() {
    tapHaptic();
    await supabase.auth.signOut();
  }

  function handleEditPress() {
    tapHaptic();
    setEditing(true);
  }

  const displayName = profile?.display_name?.trim()
    || `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
    || '';
  const initial = displayName.charAt(0).toUpperCase() || '?';
  const locationLine = profile
    ? [profile.institution, profile.city, profile.country]
        .filter((v) => v && String(v).trim().length > 0)
        .join(' · ')
    : '';

  const isIntern = profile?.cadre === 'Intern';
  const cadreBadgeVariant = (isIntern ? 'healer' : 'clinician') as React.ComponentProps<
    typeof Badge
  >['variant'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.screenTitle}>Profile</Text>
          {profile && (
            <TouchableOpacity
              style={styles.editPill}
              onPress={handleEditPress}
              activeOpacity={0.75}
            >
              <Pencil size={12} color={theme.text} />
              <Text style={styles.editPillText}>Edit profile</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Identity card */}
        <View style={styles.identityCard}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              {loading ? (
                <Skeleton width={40} height={40} borderRadius={28} />
              ) : profile?.avatar_url ? (
                <Image
                  source={{ uri: profile.avatar_url }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              ) : (
                <Text style={styles.avatarText}>{initial}</Text>
              )}
            </View>
            <View style={styles.identityInfo}>
              {loading ? (
                <Skeleton width={160} height={20} borderRadius={4} />
              ) : (
                <View style={styles.nameRow}>
                  <Text style={styles.displayName} numberOfLines={1}>
                    {displayName || '—'}
                  </Text>
                  {profile?.verification_status === 'verified' && (
                    <ShieldCheck size={14} color={theme.accent} />
                  )}
                </View>
              )}
              {!loading && locationLine ? (
                <Text style={styles.locationLine} numberOfLines={2}>
                  {locationLine}
                </Text>
              ) : null}
              {loading ? (
                <View style={styles.badgeSkeleton}>
                  <Skeleton width={120} height={20} borderRadius={Radii.chip} />
                </View>
              ) : profile?.cadre ? (
                <View style={styles.badgeRow}>
                  <Badge label={profile.cadre} variant={cadreBadgeVariant} />
                </View>
              ) : null}
            </View>
          </View>

          {!loading && profile?.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : null}

          {/* Stats */}
          {!loading && profile ? (
            <View style={styles.statsRow}>
              <Stat label="Posts" value={profile.post_count ?? 0} theme={theme} />
              <Stat label="Followers" value={profile.follower_count ?? 0} theme={theme} />
              <Stat label="Following" value={profile.following_count ?? 0} theme={theme} />
              {profile.years_experience != null && (
                <Stat label="Years" value={profile.years_experience} theme={theme} />
              )}
            </View>
          ) : null}
        </View>

        {/* Specialties */}
        {!loading && profile?.specialties && profile.specialties.length > 0 && (
          <ChipSection
            title="Specialties"
            items={profile.specialties}
            theme={theme}
          />
        )}

        {/* Languages */}
        {!loading && profile?.languages && profile.languages.length > 0 && (
          <ChipSection
            title="Languages"
            items={profile.languages}
            theme={theme}
          />
        )}

        {/* Interests */}
        {!loading && profile?.interests && profile.interests.length > 0 && (
          <ChipSection
            title="Interests"
            items={profile.interests}
            theme={theme}
          />
        )}

        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={handleSignOut}
          >
            <View style={[styles.menuIcon, { backgroundColor: theme.dangerWash }]}>
              <LogOut size={16} color={theme.danger} />
            </View>
            <Text style={[styles.menuLabel, { color: theme.danger }]}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {profile && (
        <EditProfileModal
          open={editing}
          onClose={() => setEditing(false)}
          profile={profile}
          onSaved={(p) => {
            setProfile(p);
            setEditing(false);
          }}
          theme={theme}
        />
      )}
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  theme,
}: {
  label: string;
  value: number | string;
  theme: Theme;
}) {
  const styles = makeStyles(theme);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ChipSection({
  title,
  items,
  theme,
}: {
  title: string;
  items: string[];
  theme: Theme;
}) {
  const styles = makeStyles(theme);
  return (
    <View>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>
        <View style={styles.chipRow}>
          {items.map((label) => (
            <View key={label} style={styles.chip}>
              <Text style={styles.chipLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  profile: PhysicianProfile;
  onSaved: (p: PhysicianProfile) => void;
  theme: Theme;
}

function EditProfileModal({
  open,
  onClose,
  profile,
  onSaved,
  theme,
}: EditProfileModalProps) {
  const styles = makeStyles(theme);
  const [form, setForm] = useState<FormState>(() => toForm(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toForm(profile));
      setError(null);
    }
  }, [open, profile]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const years = form.years_experience.trim();
    const payload: Record<string, unknown> = {
      display_name: form.display_name.trim() || undefined,
      first_name: form.first_name.trim() || undefined,
      last_name: form.last_name.trim() || undefined,
      bio: form.bio.trim() || undefined,
      phone: form.phone.trim() || undefined,
      country: form.country.trim() || undefined,
      city: form.city.trim() || undefined,
      institution: form.institution.trim() || undefined,
      avatar_url: form.avatar_url.trim() || undefined,
      years_experience: years ? Number(years) : undefined,
      specialties: splitList(form.specialties),
      languages: splitList(form.languages),
      interests: splitList(form.interests),
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not signed in');
      const updated = await updateProfile(payload, token);
      successHaptic();
      onSaved(updated);
    } catch (err) {
      errorHaptic();
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalRoot} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit profile</Text>
            <TouchableOpacity
              onPress={() => {
                tapHaptic();
                onClose();
              }}
              style={styles.modalCloseBtn}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <X size={18} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Field label="Display name" theme={theme}>
              <ThemedInput
                value={form.display_name}
                onChangeText={(v) => update('display_name', v)}
                theme={theme}
              />
            </Field>
            <View style={styles.row}>
              <Field label="First name" theme={theme} flex>
                <ThemedInput
                  value={form.first_name}
                  onChangeText={(v) => update('first_name', v)}
                  theme={theme}
                />
              </Field>
              <Field label="Last name" theme={theme} flex>
                <ThemedInput
                  value={form.last_name}
                  onChangeText={(v) => update('last_name', v)}
                  theme={theme}
                />
              </Field>
            </View>
            <Field label="Bio" theme={theme}>
              <ThemedInput
                value={form.bio}
                onChangeText={(v) => update('bio', v)}
                multiline
                numberOfLines={3}
                theme={theme}
                style={{ minHeight: 80, textAlignVertical: 'top' }}
              />
            </Field>
            <Field label="Phone" theme={theme}>
              <ThemedInput
                value={form.phone}
                onChangeText={(v) => update('phone', v)}
                placeholder="+254712548901"
                keyboardType="phone-pad"
                theme={theme}
              />
            </Field>
            <View style={styles.row}>
              <Field label="Country" theme={theme} flex>
                <ThemedInput
                  value={form.country}
                  onChangeText={(v) => update('country', v)}
                  theme={theme}
                />
              </Field>
              <Field label="City" theme={theme} flex>
                <ThemedInput
                  value={form.city}
                  onChangeText={(v) => update('city', v)}
                  theme={theme}
                />
              </Field>
            </View>
            <Field label="Institution" theme={theme}>
              <ThemedInput
                value={form.institution}
                onChangeText={(v) => update('institution', v)}
                placeholder="Hospital, clinic, or university"
                theme={theme}
              />
            </Field>
            <Field label="Years of experience" theme={theme}>
              <ThemedInput
                value={form.years_experience}
                onChangeText={(v) => update('years_experience', v.replace(/[^\d]/g, ''))}
                placeholder="e.g. 5"
                keyboardType="number-pad"
                theme={theme}
              />
            </Field>
            <Field label="Specialties" hint="Comma-separated" theme={theme}>
              <ThemedInput
                value={form.specialties}
                onChangeText={(v) => update('specialties', v)}
                placeholder="Internal Medicine, Paediatrics"
                theme={theme}
              />
            </Field>
            <Field label="Languages" hint="Comma-separated" theme={theme}>
              <ThemedInput
                value={form.languages}
                onChangeText={(v) => update('languages', v)}
                placeholder="English, Swahili"
                theme={theme}
              />
            </Field>
            <Field label="Interests" hint="Comma-separated" theme={theme}>
              <ThemedInput
                value={form.interests}
                onChangeText={(v) => update('interests', v)}
                placeholder="Sepsis, AMR, EM triage"
                theme={theme}
              />
            </Field>
            <Field label="Avatar URL" theme={theme}>
              <ThemedInput
                value={form.avatar_url}
                onChangeText={(v) => update('avatar_url', v)}
                placeholder="https://…"
                autoCapitalize="none"
                theme={theme}
              />
            </Field>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalSpacer} />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnGhost]}
              onPress={() => {
                tapHaptic();
                onClose();
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.modalBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalBtn,
                styles.modalBtnPrimary,
                saving && styles.modalBtnDisabled,
              ]}
              onPress={() => {
                tapHaptic();
                handleSave();
              }}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={theme.textInverse} />
              ) : (
                <Text style={styles.modalBtnPrimaryText}>Save changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({
  label,
  hint,
  flex,
  theme,
  children,
}: {
  label: string;
  hint?: string;
  flex?: boolean;
  theme: Theme;
  children: React.ReactNode;
}) {
  const styles = makeStyles(theme);
  return (
    <View style={[styles.field, flex && styles.fieldFlex]}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ThemedInput({
  theme,
  style,
  ...rest
}: React.ComponentProps<typeof TextInput> & { theme: Theme }) {
  const styles = makeStyles(theme);
  return (
    <TextInput
      placeholderTextColor={theme.textMuted}
      style={[styles.input, style]}
      {...rest}
    />
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg },
    flex: { flex: 1 },
    scrollContent: { padding: Spacing.s5, gap: Spacing.s4, paddingBottom: 32 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.s2,
    },
    screenTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: FontSizes.h1,
      color: theme.text,
      letterSpacing: -0.3,
    },
    editPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: Radii.pill,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    editPillText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      color: theme.text,
      letterSpacing: -0.05,
    },

    identityCard: {
      borderRadius: Radii.hero,
      padding: 20,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      gap: Spacing.s3,
    },
    identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarText: {
      fontFamily: Fonts.sansBold,
      fontSize: 22,
      color: theme.accent,
    },
    identityInfo: { flex: 1, gap: 4 },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    displayName: {
      fontFamily: Fonts.sansBold,
      fontSize: 18,
      color: theme.text,
      letterSpacing: -0.2,
    },
    locationLine: {
      fontFamily: Fonts.sans,
      fontSize: 13,
      color: theme.textSecondary,
    },
    badgeSkeleton: { marginTop: 4 },
    badgeRow: { marginTop: 4 },

    bio: {
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 20,
    },

    statsRow: {
      flexDirection: 'row',
      gap: 24,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    stat: { alignItems: 'flex-start' },
    statValue: {
      fontFamily: Fonts.sansBold,
      fontSize: 18,
      color: theme.text,
      letterSpacing: -0.2,
    },
    statLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 11,
      color: theme.textMuted,
      marginTop: 2,
      letterSpacing: 0.2,
    },

    sectionLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 10,
      color: theme.accent,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      paddingLeft: 4,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: Radii.card,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 16,
    },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: Radii.pill,
      backgroundColor: theme.elevated,
      borderWidth: 1,
      borderColor: theme.border,
    },
    chipLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: FontSizes.bodySm,
      color: theme.text,
    },

    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    menuIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    menuLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 14,
    },

    bottomSpacer: { height: 100 },

    // Modal
    modalRoot: { flex: 1, backgroundColor: theme.bg },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    modalTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 16,
      color: theme.text,
      letterSpacing: -0.2,
    },
    modalCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      padding: 20,
      gap: Spacing.s4,
    },
    modalSpacer: { height: 16 },
    row: { flexDirection: 'row', gap: 10 },
    field: { gap: 6 },
    fieldFlex: { flex: 1 },
    fieldLabelRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    fieldLabel: {
      fontFamily: Fonts.sansBold,
      fontSize: 11,
      color: theme.textMuted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    fieldHint: {
      fontFamily: Fonts.sans,
      fontSize: 10,
      color: theme.textMuted,
      letterSpacing: 0,
    },
    input: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontFamily: Fonts.sans,
      fontSize: 14,
      color: theme.text,
    },
    errorBox: {
      backgroundColor: theme.dangerWash,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.danger,
      padding: 10,
    },
    errorText: {
      fontFamily: Fonts.sans,
      fontSize: 12,
      color: theme.danger,
    },
    modalFooter: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    modalBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBtnGhost: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.border,
    },
    modalBtnGhostText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 14,
      color: theme.textSecondary,
    },
    modalBtnPrimary: {
      backgroundColor: theme.accent,
    },
    modalBtnPrimaryText: {
      fontFamily: Fonts.sansBold,
      fontSize: 14,
      color: '#FFFFFF',
    },
    modalBtnDisabled: { opacity: 0.5 },
  });
}
