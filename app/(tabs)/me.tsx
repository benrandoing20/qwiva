import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Settings, ChevronRight, Award, FileText, BookOpen, Star, LogOut } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { Badge } from '../../src/components/ui/Badge';
import { supabase } from '../../src/lib/supabase';

type Profile = {
  first_name: string | null;
  last_name: string | null;
  cadre: string | null;
  specialties: string[] | null;
  current_rotation: string[] | null;
};

type MenuRowProps = {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  sub?: string;
  danger?: boolean;
  onPress?: () => void;
};

function MenuRow({ icon: Icon, label, sub, danger, onPress }: MenuRowProps) {
  return (
    <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.menuIcon, danger ? styles.menuIconDanger : styles.menuIconDefault]}>
        <Icon size={18} color={danger ? Colors.danger : Colors.purple} />
      </View>
      <View style={styles.menuRowContent}>
        <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
        {sub && <Text style={styles.menuSub}>{sub}</Text>}
      </View>
      <ChevronRight size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
          .from('profiles')
          .select('first_name, last_name, cadre, specialties, current_rotation')
          .eq('id', session.user.id)
          .single();
        setProfile(data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const displayName = profile
    ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
    : '';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const isIntern = profile?.cadre === 'Intern';
  const chips = isIntern ? (profile?.current_rotation ?? []) : (profile?.specialties ?? []);
  const chipsLabel = isIntern ? 'Current rotations' : 'Your specialities';
  const badgeVariant = (
    profile?.cadre === 'Intern' ? 'healer' : 'clinician'
  ) as React.ComponentProps<typeof Badge>['variant'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <Text style={styles.screenTitle}>Profile</Text>
          <TouchableOpacity style={styles.settingsBtn}>
            <Settings size={18} color={Colors.navy} />
          </TouchableOpacity>
        </View>

        {/* Tier hero card */}
        <View style={styles.tierHero}>
          <View style={styles.tierBgGlow} pointerEvents="none" />
          <View style={styles.tierTop}>
            <View style={styles.tierAvatar}>
              {loading
                ? <Skeleton width={32} height={20} borderRadius={4} />
                : <Text style={styles.tierAvatarText}>{initials || '?'}</Text>
              }
            </View>
            <View style={styles.tierInfo}>
              <Text style={styles.tierEyebrow}>The Healer</Text>
              {loading
                ? <Skeleton width={140} height={18} borderRadius={4} />
                : <Text style={styles.tierName}>{displayName || '—'}</Text>
              }
              {loading
                ? <View style={styles.badgeSkeleton}><Skeleton width={100} height={18} borderRadius={Radii.chip} /></View>
                : profile?.cadre
                  ? <View style={styles.badgeRow}><Badge label={profile.cadre} variant={badgeVariant} /></View>
                  : null
              }
            </View>
          </View>

          {/* Stats — skeletons until Phase 2 */}
          <View style={styles.statsRow}>
            {(['XP', 'Streak', 'CPD hrs'] as const).map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && <View style={styles.statDivider} />}
                <View style={styles.statPill}>
                  <Skeleton width={44} height={20} borderRadius={4} />
                  <Text style={styles.statLabel}>{label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* Specialities / Rotations */}
        <Text style={styles.sectionLabel}>{chipsLabel}</Text>
        <View style={styles.card}>
          {loading ? (
            <View style={styles.chipRow}>
              {[120, 90, 110].map((w, i) => (
                <Skeleton key={i} width={w} height={28} borderRadius={Radii.pill} />
              ))}
            </View>
          ) : chips.length > 0 ? (
            <View style={styles.chipRow}>
              {chips.map(label => (
                <View key={label} style={styles.chip}>
                  <Text style={styles.chipLabel}>{label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Not set</Text>
          )}
        </View>

        {/* Account menu */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <MenuRow icon={Award} label="My certificates" />
          <View style={styles.menuSep} />
          <MenuRow icon={FileText} label="Export CPD record" />
          <View style={styles.menuSep} />
          <MenuRow icon={BookOpen} label="Saved cases" />
          <View style={styles.menuSep} />
          <MenuRow icon={Star} label="Leaderboard" />
          <View style={styles.menuSep} />
          <MenuRow icon={LogOut} label="Sign out" danger onPress={handleSignOut} />
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  scrollContent: { padding: Spacing.s5, gap: Spacing.s4, paddingBottom: 32 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.s2,
  },
  screenTitle: { fontFamily: Fonts.display, fontSize: FontSizes.h1, color: Colors.navy },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tierHero: {
    borderRadius: Radii.hero,
    padding: 20,
    overflow: 'hidden',
    backgroundColor: Colors.navy,
    gap: Spacing.s4,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 10,
  },
  tierBgGlow: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(111,80,145,0.5)',
  },
  tierTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tierInfo: { flex: 1, gap: 4 },
  tierAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.lilac,
  },
  tierAvatarText: { fontFamily: Fonts.display, fontSize: 20, color: Colors.textInverse },
  tierEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.lilac,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  tierName: { fontFamily: Fonts.sansBold, fontSize: 18, color: Colors.textInverse },
  badgeSkeleton: { marginTop: 2 },
  badgeRow: { marginTop: 2 },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radii.card,
    padding: 14,
  },
  statPill: { flex: 1, alignItems: 'center', gap: 4 },
  statLabel: { fontFamily: Fonts.sans, fontSize: 11, color: 'rgba(240,240,248,0.65)' },
  statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.15)' },

  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.purple,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingLeft: 4,
  },
  card: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    padding: 16,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radii.pill,
    backgroundColor: Colors.bgNavyWash,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  chipLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySm, color: Colors.navy },
  emptyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySm, color: Colors.textMuted },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  menuRowContent: { flex: 1 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuIconDefault: { backgroundColor: 'rgba(111,80,145,0.08)' },
  menuIconDanger: { backgroundColor: Colors.dangerWash },
  menuLabel: { fontFamily: Fonts.sansMedium, fontSize: 14, color: Colors.textPrimary },
  menuLabelDanger: { color: Colors.danger },
  menuSub: { fontFamily: Fonts.sans, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  menuSep: { height: 1, backgroundColor: Colors.bgSurface, marginVertical: 10 },

  bottomSpacer: { height: 100 },
});
