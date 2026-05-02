# Production-Ready Completion — All Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every broken screen and missing component so the Qwiva mobile app is fully production-ready end-to-end while staying on Expo Go SDK 54.

**Architecture:** Eight tasks split into two parts. Part A (Tasks 1–3) completes the auth funnel — these must be done in order as each screen hands off to the next. Part B (Tasks 4–8) polishes the tab screens — Task 4 (Skeleton) must precede Tasks 5 and 6 since they use it. All animation uses `react-native-reanimated ~4.1.1`; no `Animated` from `react-native`. All auth calls use the existing `src/lib/supabase.ts` client. No new packages except `expo-linear-gradient` in Task 4.

**Tech Stack:** expo-router (navigation), @supabase/supabase-js (auth + DB), react-native-reanimated 4.1.1, expo-linear-gradient (Skeleton shimmer), react-native-safe-area-context, lucide-react-native

---

## Current-State Audit

### Done ✅
| File | Status |
|---|---|
| `app/_layout.tsx` | `useQwivaFonts()` + `onAuthStateChange` session listener |
| `app/index.tsx` | Session check → redirect |
| `app/onboarding/index.tsx` | Landing screen |
| `app/onboarding/login.tsx` | Email + password, Supabase, Reanimated entry |
| `app/onboarding/_layout.tsx` | All 5 screens registered |
| `src/components/ui/Button.tsx` | Reanimated spring press |
| `src/components/ui/Input.tsx` | Focus state |
| `src/lib/supabase.ts` | Supabase client |
| `src/lib/motion.ts` | `springConfig` + `DURATION` |
| `src/hooks/useFonts.ts` | All fonts (Lora + JetBrains Mono + Gotham) |
| `app/(tabs)/_layout.tsx` | Tab bar + BlurView on iOS |
| `app/case.tsx` | MCQ demo screen |
| `app/(tabs)/pulse.tsx` | Layout complete (mock data OK for now) |

### Broken / Missing ❌
| File | Issues |
|---|---|
| `app/onboarding/register.tsx` | Collects name+phone (wrong); no Supabase auth; no Reanimated; raw `TouchableOpacity` footer (not `Button`) |
| `app/onboarding/specialty.tsx` | `Colors.pink` on chip icons, check marks, status dots (rule violation); pre-populates 3 selections; no Supabase save; no Reanimated; inline styles in ProgressBar |
| `app/onboarding/verify.tsx` | `Animated` from react-native (rule violation); uncontrolled input (`defaultValue` not `value`); no Supabase save; raw `TouchableOpacity` buttons |
| `src/components/ui/Skeleton.tsx` | Does not exist — required by CLAUDE.md |
| `app/(tabs)/ask.tsx` | Input doesn't submit; empty `<View>` suggestion icons; greeting hardcoded to "Dr. Amara"; multiple hardcoded hex colors |
| `app/(tabs)/me.tsx` | `pointerEvents` in style object (RN warning); all data hardcoded; no sign-out action |
| `app/(tabs)/feed.tsx` | Poll votes not interactive |
| `app/(tabs)/learn.tsx` | Module taps don't navigate anywhere |

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/onboarding/register.tsx` | Rebuild | Email + password form, `supabase.auth.signUp`, loading/error states, Reanimated entry |
| `app/onboarding/specialty.tsx` | Rebuild | Pink → lilac fix, AnimatedChip spring, `supabase.from('profiles').upsert`, Reanimated entry |
| `app/onboarding/verify.tsx` | Rebuild | Reanimated spinner, controlled KMPDC input, `supabase.from('profiles').upsert`, skip path |
| `src/components/ui/Skeleton.tsx` | Create | Shimmer placeholder using Reanimated + expo-linear-gradient |
| `app/(tabs)/ask.tsx` | Rebuild | Real user greeting from `supabase.auth.getUser()`, real icons in suggestions, submit → `/case` |
| `app/(tabs)/me.tsx` | Rebuild | Real user name/specialties/KMPDC from Supabase, `supabase.auth.signOut()`, Skeleton loading state |
| `app/(tabs)/feed.tsx` | Modify | Interactive polls with `useState` selected option + mock percentages |
| `app/(tabs)/learn.tsx` | Modify | `router.push('/case')` on module tap, add `router` import |

---

## Supabase prerequisite — run once in the dashboard

Before Task 1, create the `profiles` table if it doesn't exist yet. In Supabase dashboard → SQL Editor:

```sql
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  specialties text[] default '{}',
  kmpdc_number text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
```

---

## Task 1: register.tsx — email + password + Supabase signUp

**Files:**
- Rebuild: `app/onboarding/register.tsx`

Collect email + password (Supabase auth fields). Call `supabase.auth.signUp`. Show loading on Button, inline error on failure. Reanimated entry. "Already have an account?" link to login.

- [ ] **Step 1: Replace register.tsx in full**

```tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ShieldCheck } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { DURATION } from '../../src/lib/motion';
import { supabase } from '../../src/lib/supabase';
import { track } from '../../src/lib/analytics';

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.progressDot,
            i < step ? styles.progressActive : styles.progressInactive,
          ]}
        />
      ))}
    </View>
  );
}

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const containerOpacity = useSharedValue(0);
  const containerY = useSharedValue(24);

  useEffect(() => {
    track('onboarding_register_viewed');
    containerOpacity.value = withTiming(1, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
    containerY.value = withTiming(0, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ translateY: containerY.value }],
  }));

  async function handleSignUp() {
    if (!email.trim() || !password) {
      setError('Please enter your email and a password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    track('onboarding_register_completed');
    router.push('/onboarding/specialty');
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={18} color={Colors.navy} />
          </TouchableOpacity>
          <ProgressBar step={1} total={3} />
          <View style={styles.navSpacer} />
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={containerStyle}>
            <Text style={styles.eyebrow}>Step 1 of 3</Text>
            <Text style={styles.headline}>Create your{'\n'}clinical account.</Text>
            <Text style={styles.subtitle}>
              Free for verified clinicians. Your CPD record starts immediately.
            </Text>

            <View style={styles.fields}>
              <Input
                label="Email"
                placeholder="your@email.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
              />
              <Input
                label="Password"
                placeholder="At least 6 characters"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleSignUp}
              />
            </View>

            {error !== '' && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.valueProp}>
              <View style={styles.valuePropRow}>
                <ShieldCheck size={18} color={Colors.info} />
                <Text style={styles.valuePropTitle}>CPD-logged from day one</Text>
              </View>
              <Text style={styles.valuePropBody}>
                Every case, answer, and module counts toward KMPDC-recognised CPD hours.
                Export anytime.
              </Text>
            </View>
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Continue"
            variant="navy"
            size="lg"
            loading={loading}
            onPress={handleSignUp}
          />
          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => router.replace('/onboarding/login')}
          >
            <Text style={styles.switchText}>
              Already have an account?{' '}
              <Text style={styles.switchLink}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgBase },
  flex: { flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRow: { flexDirection: 'row', gap: 4 },
  progressDot: { width: 24, height: 3, borderRadius: 2 },
  progressActive: { backgroundColor: Colors.purple },
  progressInactive: { backgroundColor: Colors.borderDefault },
  navSpacer: { width: 36 },
  scrollContent: { padding: Spacing.s7, paddingBottom: Spacing.s8 },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.h1,
    color: Colors.navy,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginTop: Spacing.s2,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginTop: Spacing.s2,
    marginBottom: Spacing.s6,
  },
  fields: { gap: Spacing.s4 },
  errorBox: {
    marginTop: Spacing.s4,
    backgroundColor: Colors.dangerWash,
    borderRadius: Radii.button,
    padding: Spacing.s3,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.danger,
    lineHeight: 18,
  },
  valueProp: {
    marginTop: Spacing.s6,
    backgroundColor: Colors.bgNavyWash,
    borderRadius: Radii.card,
    padding: Spacing.s4,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    gap: Spacing.s2,
  },
  valuePropRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  valuePropTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySm,
    color: Colors.navy,
  },
  valuePropBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.label,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: Spacing.s7,
    paddingBottom: Spacing.s6,
    gap: Spacing.s3,
  },
  switchRow: { alignItems: 'center', paddingVertical: Spacing.s2 },
  switchText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySm,
    color: Colors.textSecondary,
  },
  switchLink: { fontFamily: Fonts.sansBold, color: Colors.purple },
});
```

- [ ] **Step 2: Verify in Expo Go**

1. From the landing screen tap "Sign Up" — register screen slides in, content fades up.
2. Tap "Continue" with empty fields — inline error box appears (no `alert()`).
3. Enter email + password shorter than 6 chars — error says "at least 6 characters".
4. Enter valid email + 6+ char password, tap "Continue" — loading spinner on button, then navigates to specialty screen.
5. Tap "Already have an account? Sign in" — navigates to login screen.

- [ ] **Step 3: Commit**

```bash
git add app/onboarding/register.tsx
git commit -m "feat: rebuild register screen with email+password and Supabase signUp"
```

---

## Task 2: specialty.tsx — pink fix + AnimatedChip spring + Supabase upsert

**Files:**
- Rebuild: `app/onboarding/specialty.tsx`

Remove all `Colors.pink` uses (chip icons, check marks, status dots → use `Colors.lilac` and `Colors.purple`). Add `AnimatedChip` subcomponent with Reanimated spring press. Add screen entry animation. Save selected specialties to Supabase `profiles` on continue. Start with empty selection. Use `Button` component.

- [ ] **Step 1: Replace specialty.tsx in full**

```tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft, Check,
  Stethoscope, Baby, HeartPulse, Activity, Scissors, Users, Bug, Brain, Syringe,
} from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { Button } from '../../src/components/ui/Button';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { DURATION, springConfig } from '../../src/lib/motion';
import { supabase } from '../../src/lib/supabase';
import { track } from '../../src/lib/analytics';

const MAX_SELECTIONS = 3;

const SPECIALTIES = [
  { label: 'Internal Medicine', Icon: Stethoscope },
  { label: 'Paediatrics', Icon: Baby },
  { label: 'Obs & Gynae', Icon: HeartPulse },
  { label: 'Emergency', Icon: Activity },
  { label: 'Surgery', Icon: Scissors },
  { label: 'Family Medicine', Icon: Users },
  { label: 'Infectious Disease', Icon: Bug },
  { label: 'Psychiatry', Icon: Brain },
  { label: 'Anaesthesia', Icon: Syringe },
];

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.progressDot,
            i < step ? styles.progressActive : styles.progressInactive,
          ]}
        />
      ))}
    </View>
  );
}

function AnimatedChip({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePressIn() {
    scale.value = withSpring(0.94, springConfig);
  }

  function handlePressOut() {
    scale.value = withSpring(1, springConfig);
  }

  return (
    <Animated.View style={animStyle}>
      <TouchableOpacity
        style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <Icon size={14} color={active ? Colors.lilac : Colors.purple} />
        <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelInactive]}>
          {label}
        </Text>
        {active && <Check size={14} color={Colors.lilac} />}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function SpecialtyScreen() {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const containerOpacity = useSharedValue(0);
  const containerY = useSharedValue(24);

  useEffect(() => {
    track('onboarding_specialty_viewed');
    containerOpacity.value = withTiming(1, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
    containerY.value = withTiming(0, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ translateY: containerY.value }],
  }));

  function toggleSpecialty(label: string) {
    setSelected(prev => {
      if (prev.includes(label)) return prev.filter(s => s !== label);
      if (prev.length >= MAX_SELECTIONS) return prev;
      return [...prev, label];
    });
  }

  async function handleContinue() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('profiles').upsert({ id: user.id, specialties: selected });
    }
    setSaving(false);
    track('onboarding_specialty_completed', { specialties: selected });
    router.push('/onboarding/verify');
  }

  const maxReached = selected.length >= MAX_SELECTIONS;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={18} color={Colors.navy} />
        </TouchableOpacity>
        <ProgressBar step={2} total={3} />
        <TouchableOpacity onPress={() => router.push('/onboarding/verify')}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={containerStyle}>
          <Text style={styles.eyebrow}>Step 2 of 3</Text>
          <Text style={styles.headline}>What kind of cases{'\n'}do you see most?</Text>
          <Text style={styles.subtitle}>
            Pick up to three. You'll see more evidence and CME in these areas.
          </Text>

          <View style={styles.chipGrid}>
            {SPECIALTIES.map(({ label, Icon }) => (
              <AnimatedChip
                key={label}
                label={label}
                Icon={Icon}
                active={selected.includes(label)}
                onPress={() => toggleSpecialty(label)}
              />
            ))}
          </View>

          <View style={styles.statusRow}>
            <View style={styles.dots}>
              {[0, 1, 2].map(i => (
                <View
                  key={i}
                  style={[styles.dot, i < selected.length ? styles.dotActive : styles.dotInactive]}
                />
              ))}
            </View>
            <Text style={styles.statusText}>
              {selected.length} of {MAX_SELECTIONS} selected
              {maxReached ? ' · max reached' : ''}
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={selected.length > 0 ? `Continue with ${selected.length} selected` : 'Continue'}
          variant="navy"
          size="lg"
          loading={saving}
          disabled={selected.length === 0}
          onPress={handleContinue}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRow: { flexDirection: 'row', gap: 4 },
  progressDot: { width: 24, height: 3, borderRadius: 2 },
  progressActive: { backgroundColor: Colors.purple },
  progressInactive: { backgroundColor: Colors.borderDefault },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySm, color: Colors.purple },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.s7, paddingBottom: Spacing.s8 },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.h1,
    color: Colors.navy,
    lineHeight: 34,
    letterSpacing: -0.5,
    marginTop: Spacing.s2,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginTop: Spacing.s2,
    marginBottom: Spacing.s5,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: Colors.navy,
    borderColor: Colors.navy,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  chipInactive: { backgroundColor: Colors.bgElevated, borderColor: Colors.borderDefault },
  chipLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm },
  chipLabelActive: { color: Colors.textInverse },
  chipLabelInactive: { color: Colors.textPrimary },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    marginTop: Spacing.s4,
  },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: Colors.purple },
  dotInactive: { backgroundColor: Colors.borderDefault },
  statusText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.label,
    color: Colors.purple,
    letterSpacing: 0.2,
  },
  footer: { paddingHorizontal: Spacing.s7, paddingBottom: Spacing.s6 },
});
```

- [ ] **Step 2: Verify in Expo Go**

1. Complete registration — arrive at specialty screen with entry fade.
2. Tap a chip — spring compresses and releases, icon is lilac (not pink), check mark is lilac (not pink).
3. Select 3 chips — dots are purple (not pink), counter shows "3 of 3 · max reached".
4. Tap "Continue with 3 selected" — loading spinner, then navigates to verify screen.
5. In Supabase dashboard → Table Editor → `profiles` — row should appear with the specialties array.

- [ ] **Step 3: Commit**

```bash
git add app/onboarding/specialty.tsx
git commit -m "feat: fix pink violations, add chip spring animation and Supabase save to specialty screen"
```

---

## Task 3: verify.tsx — Reanimated spinner + controlled input + Supabase upsert

**Files:**
- Rebuild: `app/onboarding/verify.tsx`

Replace `Animated` from react-native with Reanimated `withRepeat`. Make KMPDC input controlled. Save to Supabase on submit. Skip navigates without saving. Use `Button` component. Fix `pointerEvents` in tierGlow (move from style to prop).

- [ ] **Step 1: Replace verify.tsx in full**

```tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Search, Stethoscope, Check } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { Input } from '../../src/components/ui/Input';
import { Button } from '../../src/components/ui/Button';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { DURATION } from '../../src/lib/motion';
import { supabase } from '../../src/lib/supabase';
import { track } from '../../src/lib/analytics';

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.progressRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.progressDot,
            i < step ? styles.progressActive : styles.progressInactive,
          ]}
        />
      ))}
    </View>
  );
}

export default function VerifyScreen() {
  const [kmpdc, setKmpdc] = useState('');
  const [saving, setSaving] = useState(false);

  const containerOpacity = useSharedValue(0);
  const containerY = useSharedValue(24);
  const rotation = useSharedValue(0);

  useEffect(() => {
    track('onboarding_verify_viewed');
    containerOpacity.value = withTiming(1, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
    containerY.value = withTiming(0, {
      duration: DURATION.screen,
      easing: Easing.out(Easing.quad),
    });
    rotation.value = withRepeat(
      withTiming(360, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ translateY: containerY.value }],
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  async function handleSubmit() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user && kmpdc.trim()) {
      await supabase.from('profiles').upsert({
        id: user.id,
        kmpdc_number: kmpdc.trim().toUpperCase(),
      });
    }
    setSaving(false);
    track('onboarding_verify_submitted', { provided: !!kmpdc.trim() });
    router.replace('/(tabs)/ask');
  }

  function handleSkip() {
    track('onboarding_verify_skipped');
    router.replace('/(tabs)/ask');
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={18} color={Colors.navy} />
        </TouchableOpacity>
        <ProgressBar step={3} total={3} />
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[containerStyle, styles.content]}>
          <Text style={styles.eyebrow}>Step 3 of 3</Text>
          <Text style={styles.headline}>Your KMPDC number.</Text>
          <Text style={styles.subtitle}>
            Unlocks the <Text style={styles.subtitleBold}>Clinician tier</Text>,
            CPD-logged answers, and peer polls. Verified in the background — keep using
            Qwiva meanwhile.
          </Text>

          <Input
            label="KMPDC Registration No."
            placeholder="KMPDC/MD/YYYY/XXXXX"
            value={kmpdc}
            onChangeText={setKmpdc}
            mono
            autoCapitalize="characters"
            returnKeyType="done"
          />
          <Text style={styles.hint}>
            We verify against the public KMPDC register. Never shared.
          </Text>

          <View style={styles.verifyStatus}>
            <View style={styles.spinnerWrap}>
              <Search size={15} color={Colors.info} />
              <Animated.View style={[styles.spinnerRing, spinnerStyle]} />
            </View>
            <View style={styles.verifyText}>
              <Text style={styles.verifyTitle}>Checking KMPDC register…</Text>
              <Text style={styles.verifyBody}>
                You can keep using the app — we'll notify you.
              </Text>
            </View>
          </View>

          <Text style={styles.tierEyebrow}>Tier preview · once verified</Text>
          <View style={styles.tierCard}>
            <View style={styles.tierGlow} pointerEvents="none" />
            <View style={styles.tierHeader}>
              <View style={styles.tierIcon}>
                <Stethoscope size={22} color={Colors.textInverse} />
              </View>
              <View style={styles.tierMeta}>
                <Text style={styles.tierLabel}>Clinician tier</Text>
                <Text style={styles.tierName}>Full clinical access</Text>
              </View>
            </View>
            <View style={styles.tierFeatures}>
              {[
                'Peer polls & benchmarking',
                'CPD certificates & export',
                'Case-based MCQs with rationale',
              ].map((feature, i) => (
                <View key={i} style={styles.tierFeatureRow}>
                  <Check size={14} color={Colors.success} />
                  <Text style={styles.tierFeatureText}>{feature}</Text>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Submit & continue"
          variant="navy"
          size="lg"
          loading={saving}
          onPress={handleSubmit}
        />
        <TouchableOpacity style={styles.skipRow} onPress={handleSkip}>
          <Text style={styles.skipText}>I'll verify later</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRow: { flexDirection: 'row', gap: 4 },
  progressDot: { width: 24, height: 3, borderRadius: 2 },
  progressActive: { backgroundColor: Colors.purple },
  progressInactive: { backgroundColor: Colors.borderDefault },
  navSpacer: { width: 36 },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.s7, paddingBottom: Spacing.s8 },
  content: { gap: Spacing.s4 },
  eyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.h1,
    color: Colors.navy,
    lineHeight: 34,
    letterSpacing: -0.5,
    marginTop: Spacing.s2,
  },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginTop: Spacing.s2,
  },
  subtitleBold: { fontFamily: Fonts.sansBold, color: Colors.navy },
  hint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.label,
    color: Colors.textMuted,
    marginTop: -Spacing.s2,
  },
  verifyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: Spacing.s4,
    borderRadius: Radii.card,
    backgroundColor: Colors.bgNavyWash,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  spinnerWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.bgElevated,
    borderWidth: 2,
    borderColor: Colors.info,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  spinnerRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: Colors.purple,
  },
  verifyText: { flex: 1 },
  verifyTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm, color: Colors.navy },
  verifyBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.label,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  tierEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingLeft: Spacing.s1,
  },
  tierCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.hero,
    padding: Spacing.s5,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    overflow: 'hidden',
    gap: Spacing.s4,
  },
  tierGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(178,136,185,0.15)',
  },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s3 },
  tierIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 5,
  },
  tierMeta: { flex: 1 },
  tierLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tierName: {
    fontFamily: Fonts.displayMedium,
    fontSize: FontSizes.h3,
    color: Colors.navy,
    marginTop: 2,
  },
  tierFeatures: { gap: Spacing.s2 },
  tierFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  tierFeatureText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySm, color: Colors.textPrimary },
  footer: { paddingHorizontal: Spacing.s7, paddingBottom: Spacing.s6, gap: Spacing.s3 },
  skipRow: { alignItems: 'center', paddingVertical: Spacing.s2 },
  skipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySm, color: Colors.purple },
});
```

- [ ] **Step 2: Verify in Expo Go**

1. Complete register + specialty — arrive at verify screen with entry fade.
2. Confirm spinner rotates smoothly (Reanimated, not RN Animated — no import of `Animated` from `react-native`).
3. Type a KMPDC number in the mono input — value updates as you type.
4. Tap "Submit & continue" — loading spinner, then navigates to `/(tabs)/ask`.
5. In Supabase → `profiles` table: `kmpdc_number` column should be populated.
6. On a fresh run tap "I'll verify later" — navigates to tabs without writing to Supabase.

- [ ] **Step 3: Commit**

```bash
git add app/onboarding/verify.tsx
git commit -m "feat: replace RN Animated with Reanimated spinner, add controlled input and Supabase save to verify screen"
```

---

## Task 4: Skeleton.tsx — shimmer component

**Files:**
- Create: `src/components/ui/Skeleton.tsx`

Shimmer placeholder for all loading states. Used in Tasks 5 and 6. Shape must match the content it replaces. Animated shimmer beam using Reanimated `withRepeat` + expo-linear-gradient.

- [ ] **Step 1: Install expo-linear-gradient**

```bash
npx expo install expo-linear-gradient
npm install --legacy-peer-deps
```

Expected: `"expo-linear-gradient"` appears in `package.json` dependencies.

- [ ] **Step 2: Create src/components/ui/Skeleton.tsx**

```tsx
import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Colors, Radii } from '../../constants';

const SHIMMER_WIDTH = 160;
const TRAVEL = 350;

interface Props {
  width?: ViewStyle['width'];
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = Radii.button,
  style,
}: Props) {
  const tx = useSharedValue(-SHIMMER_WIDTH);

  useEffect(() => {
    tx.value = withRepeat(
      withTiming(TRAVEL, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  return (
    <View style={[styles.base, { height, borderRadius, width }, style]}>
      <Animated.View style={[styles.shimmer, shimmerStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.bgSurface,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SHIMMER_WIDTH,
    height: '100%',
  },
});
```

- [ ] **Step 3: Verify in Expo Go**

Add temporarily to `app/onboarding/index.tsx` to test:
```tsx
import { Skeleton } from '../../src/components/ui/Skeleton';
// inside the hero View:
<Skeleton width="80%" height={20} style={{ marginTop: 8 }} />
<Skeleton width="60%" height={14} style={{ marginTop: 6 }} />
```
Confirm the shimmer beam slides left-to-right in a loop. Remove the temporary import once confirmed.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Skeleton.tsx package.json package-lock.json
git commit -m "feat: add Skeleton shimmer component with expo-linear-gradient"
```

---

## Task 5: ask.tsx — real user greeting + real icons + submit handler

**Files:**
- Rebuild: `app/(tabs)/ask.tsx`

Load the authenticated user's email from `supabase.auth.getUser()` and derive a display name from it. Replace empty `<View>` suggestion icons with actual lucide icons. Show `Skeleton` placeholders while user data loads. Submit query → navigate to `/case` (demo placeholder for Phase 2 RAG). Fix all hardcoded color values.

- [ ] **Step 1: Replace ask.tsx in full**

```tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Bell, Flame, Sparkles, Mic, Camera, ArrowUpRight,
  Syringe, HeartPulse, Baby, Activity,
} from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { supabase } from '../../src/lib/supabase';

const TAB_BAR_HEIGHT = 72;

type Suggestion = {
  Icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  tag: string;
};

const SUGGESTIONS: Suggestion[] = [
  { Icon: Syringe, label: 'Amoxicillin dosing — paeds <5y', tag: 'Dosing' },
  { Icon: HeartPulse, label: 'ACS: STEMI vs NSTEMI triage', tag: 'Protocol' },
  { Icon: Baby, label: 'Pre-eclampsia: MgSO₄ loading', tag: 'Obs' },
  { Icon: Activity, label: 'DKA: fluid strategy, adult', tag: 'Emergency' },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function deriveDisplayName(email: string): string {
  const prefix = email.split('@')[0];
  return prefix
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function deriveInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function AskScreen() {
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [initials, setInitials] = useState('');
  const [userLoading, setUserLoading] = useState(true);
  const greeting = getGreeting();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        const name = deriveDisplayName(user.email);
        setDisplayName(name);
        setInitials(deriveInitials(name));
      }
      setUserLoading(false);
    });
  }, []);

  function handleSubmit() {
    if (!query.trim()) return;
    router.push('/case');
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              {userLoading ? (
                <Skeleton width={36} height={36} borderRadius={18} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
            </View>
            <View>
              <Text style={styles.greeting}>{greeting},</Text>
              {userLoading ? (
                <Skeleton width={80} height={14} style={{ marginTop: 2 }} />
              ) : (
                <Text style={styles.name}>{displayName}</Text>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.streakPill}>
              <Flame size={13} color={Colors.streakFire} />
              <Text style={styles.streakText}>7</Text>
            </View>
            <TouchableOpacity style={styles.notifBtn}>
              <Bell size={16} color={Colors.navy} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroText}>What can I{'\n'}help you with?</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Picking up where you left off</Text>
        {SUGGESTIONS.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={styles.suggestionRow}
            activeOpacity={0.75}
            onPress={() => router.push('/case')}
          >
            <View style={styles.suggestionIcon}>
              <s.Icon size={18} color={Colors.purple} />
            </View>
            <View style={styles.suggestionContent}>
              <Text style={styles.suggestionLabel}>{s.label}</Text>
              <Text style={styles.suggestionTag}>{s.tag}</Text>
            </View>
            <ArrowUpRight size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}

        <View style={styles.offlineBadge}>
          <View style={styles.greenDot} />
          <Text style={styles.offlineText}>Online · 412 answers cached for offline</Text>
        </View>

        <View style={{ height: TAB_BAR_HEIGHT + Spacing.s10 }} />
      </ScrollView>

      <View style={styles.inputWrapper}>
        <View style={styles.inputBar}>
          <Sparkles size={18} color={Colors.purple} />
          <TextInput
            style={styles.inputField}
            value={query}
            onChangeText={setQuery}
            placeholder="Ask anything clinical…"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
          />
          <View style={styles.inputActions}>
            <TouchableOpacity style={styles.iconBtn}>
              <Mic size={16} color={Colors.navy} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn}>
              <Camera size={16} color={Colors.navy} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  safe: { backgroundColor: Colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 + 2 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm, color: Colors.textInverse },
  greeting: { fontFamily: Fonts.sans, fontSize: FontSizes.eyebrow, color: Colors.textMuted, letterSpacing: 0.2 },
  name: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm, color: Colors.navy, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 + 2 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.s2 + 2,
    paddingVertical: 6,
    backgroundColor: Colors.warningWash,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  streakText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.label, color: Colors.warning },
  notifBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgElevated,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s6, paddingBottom: Spacing.s3 },
  heroText: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.display,
    color: Colors.navy,
    letterSpacing: -1,
    lineHeight: 38,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.gutter, paddingTop: Spacing.s2 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: Spacing.s2 + 2,
    paddingLeft: 6,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: 14,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    marginBottom: Spacing.s2,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  suggestionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.bgNavyWash,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  suggestionContent: { flex: 1 },
  suggestionLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm + 1, color: Colors.textPrimary, lineHeight: 19 },
  suggestionTag: { fontFamily: Fonts.sans, fontSize: FontSizes.eyebrow, color: Colors.textMuted, marginTop: 2 },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    marginTop: Spacing.s2,
  },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  offlineText: { fontFamily: Fonts.sans, fontSize: FontSizes.eyebrow, color: Colors.textSecondary },
  inputWrapper: {
    position: 'absolute',
    bottom: TAB_BAR_HEIGHT + Spacing.s2,
    left: Spacing.gutter,
    right: Spacing.gutter,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.hero,
    padding: 14,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
  },
  inputField: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
    padding: 0,
  },
  inputActions: { flexDirection: 'row', gap: Spacing.s2 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 2: Verify in Expo Go**

1. Navigate to the Ask tab — greeting says the correct time of day; user name derives from their email (e.g. "john.doe@gmail.com" → "John Doe"); avatar shows initials.
2. While loading, Skeleton placeholders appear in the avatar and name slots.
3. Suggestion rows show real lucide icons in the purple icon containers.
4. Tapping a suggestion navigates to `/case`.
5. Type in the input and press the keyboard send button — navigates to `/case`.
6. No hardcoded hex colors remain (streak pill uses `Colors.warningWash` + `Colors.warning`).

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/ask.tsx
git commit -m "feat: load real user greeting, add suggestion icons and submit handler to ask screen"
```

---

## Task 6: me.tsx — real user data + sign out + Skeleton loading

**Files:**
- Rebuild: `app/(tabs)/me.tsx`

Fix `pointerEvents` in style (move to prop). Load user email + profile (specialties, kmpdc_number) from Supabase. Show Skeleton placeholders during load. Add "Sign Out" action that calls `supabase.auth.signOut()` then navigates to `/onboarding`. Keep gamification stats (XP, streak, CPD hrs) as mock data — those are Phase 3 features.

- [ ] **Step 1: Replace me.tsx in full**

```tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Settings, ChevronRight, Star, FileText, BookOpen, Award, LogOut } from 'lucide-react-native';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { supabase } from '../../src/lib/supabase';

type Profile = {
  specialties: string[];
  kmpdc_number: string | null;
};

function deriveDisplayName(email: string): string {
  const prefix = email.split('@')[0];
  return prefix
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function deriveInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MenuRow({
  icon: Icon,
  label,
  sub,
  onPress,
  destructive,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  sub?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.menuIcon, destructive && styles.menuIconDestructive]}>
        <Icon size={18} color={destructive ? Colors.danger : Colors.purple} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuLabel, destructive && { color: Colors.danger }]}>{label}</Text>
        {sub && <Text style={styles.menuSub}>{sub}</Text>}
      </View>
      <ChevronRight size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [initials, setInitials] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const name = deriveDisplayName(user.email);
        setDisplayName(name);
        setInitials(deriveInitials(name));
      }
      if (user) {
        const { data: rows } = await supabase
          .from('profiles')
          .select('specialties, kmpdc_number')
          .eq('id', user.id)
          .limit(1);
        if (rows && rows.length > 0) {
          setProfile(rows[0] as Profile);
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/onboarding');
  }

  const primarySpecialty = profile?.specialties?.[0] ?? 'General Practice';
  const isVerified = !!profile?.kmpdc_number;
  const specialtyLine = `${primarySpecialty}${isVerified ? ' · KMPDC verified' : ''}`;

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
              {loading ? (
                <Skeleton width={52} height={52} borderRadius={26} />
              ) : (
                <Text style={styles.tierAvatarText}>{initials}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tierEyebrow}>The Clinician</Text>
              {loading ? (
                <>
                  <Skeleton width="70%" height={18} style={{ marginTop: 4 }} />
                  <Skeleton width="50%" height={12} style={{ marginTop: 6 }} />
                </>
              ) : (
                <>
                  <Text style={styles.tierName}>{displayName}</Text>
                  <Text style={styles.tierSpec}>{specialtyLine}</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.statsRow}>
            <StatPill label="XP" value="2,840" color={Colors.xpGold} />
            <View style={styles.statDivider} />
            <StatPill label="Streak" value="7🔥" />
            <View style={styles.statDivider} />
            <StatPill label="CPD hrs" value="14.5" color={Colors.info} />
          </View>

          <View style={styles.xpSection}>
            <View style={styles.xpLabelRow}>
              <Text style={styles.xpLabel}>Progress to The Oracle</Text>
              <Text style={styles.xpPct}>57%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: '57%' }]} />
            </View>
          </View>
        </View>

        {/* Specialty breakdown */}
        <Text style={styles.sectionLabel}>Specialty breakdown</Text>
        <View style={styles.card}>
          {loading ? (
            <>
              <Skeleton width="80%" height={13} />
              <Skeleton width="60%" height={5} style={{ marginTop: 10 }} />
              <Skeleton width="70%" height={13} style={{ marginTop: 14 }} />
              <Skeleton width="50%" height={5} style={{ marginTop: 10 }} />
            </>
          ) : (
            (profile?.specialties?.length
              ? profile.specialties.map((s, i) => ({ label: s, pct: i === 0 ? 48 : i === 1 ? 31 : 21 }))
              : [{ label: 'General Practice', pct: 100 }]
            ).map((s, i) => (
              <View key={i} style={[styles.specRow, i > 0 && { marginTop: 14 }]}>
                <View style={styles.specLabelRow}>
                  <Text style={styles.specLabel}>{s.label}</Text>
                  <Text style={styles.specPct}>{s.pct}%</Text>
                </View>
                <View style={styles.specTrack}>
                  <View style={[styles.specFill, { width: `${s.pct}%` }]} />
                </View>
              </View>
            ))
          )}
        </View>

        {/* Account menu */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <MenuRow icon={Award} label="My certificates" sub="3 CPD certificates earned" />
          <View style={styles.menuSep} />
          <MenuRow icon={FileText} label="Export CPD record" />
          <View style={styles.menuSep} />
          <MenuRow icon={BookOpen} label="Saved cases" sub="12 cases bookmarked" />
          <View style={styles.menuSep} />
          <MenuRow icon={Star} label="Leaderboard" sub="Ranked #42 this month" />
          <View style={styles.menuSep} />
          <MenuRow
            icon={LogOut}
            label="Sign out"
            onPress={handleSignOut}
            destructive
          />
        </View>

        <View style={{ height: 100 }} />
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
  tierAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.purple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.lilac,
    overflow: 'hidden',
  },
  tierAvatarText: { fontFamily: Fonts.sansBold, fontSize: 20, color: Colors.textInverse },
  tierEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.lilac,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  tierName: { fontFamily: Fonts.sansBold, fontSize: 18, color: Colors.textInverse, marginTop: 2 },
  tierSpec: { fontFamily: Fonts.sans, fontSize: FontSizes.label, color: 'rgba(240,240,248,0.65)', marginTop: 3 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radii.card,
    padding: 14,
  },
  statPill: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: Fonts.sansBold, fontSize: 18, color: Colors.textInverse },
  statLabel: { fontFamily: Fonts.sans, fontSize: FontSizes.eyebrow, color: 'rgba(240,240,248,0.65)', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.15)' },
  xpSection: { gap: 8 },
  xpLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  xpLabel: { fontFamily: Fonts.sans, fontSize: FontSizes.label, color: 'rgba(240,240,248,0.7)' },
  xpPct: { fontFamily: Fonts.sansBold, fontSize: FontSizes.label, color: Colors.lilac },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.lilac, borderRadius: 2 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
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
  specRow: {},
  specLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  specLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySm, color: Colors.textPrimary },
  specPct: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm, color: Colors.textSecondary },
  specTrack: { height: 5, backgroundColor: Colors.bgSurface, borderRadius: 3, overflow: 'hidden' },
  specFill: { height: '100%', backgroundColor: Colors.purple, borderRadius: 3 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(111,80,145,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconDestructive: { backgroundColor: Colors.dangerWash },
  menuLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySm + 1, color: Colors.textPrimary },
  menuSub: { fontFamily: Fonts.sans, fontSize: FontSizes.label, color: Colors.textMuted, marginTop: 2 },
  menuSep: { height: 1, backgroundColor: Colors.bgSurface, marginVertical: 10 },
});
```

- [ ] **Step 2: Verify in Expo Go**

1. Navigate to the Me tab — Skeleton placeholders appear, then user name and specialties from Supabase load in.
2. Confirm no React Native warning about `pointerEvents` in style (it's now a prop on the glow View).
3. Avatar border is `Colors.lilac` (not `Colors.pink`).
4. "Sign out" row has red text + red icon container.
5. Tap "Sign out" — navigates to `/onboarding`, landing screen appears.
6. Signing in again → arrives at `/ask` tab with correct user data.

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/me.tsx
git commit -m "feat: load real user profile, add sign out, fix pointerEvents and pink violations in me screen"
```

---

## Task 7: feed.tsx — interactive polls

**Files:**
- Modify: `app/(tabs)/feed.tsx`

Poll option rows are currently non-interactive. Add a `votes` state map keyed by feed item index. On vote, record the chosen option and render mock percentage bars. Remove unused icon imports.

- [ ] **Step 1: Replace feed.tsx in full**

```tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, FontSizes, Spacing, Radii } from '../../src/constants';

const FEED_ITEMS = [
  {
    type: 'guideline',
    eyebrow: 'New guideline',
    title: 'Updated malaria treatment protocol — Kenya MoH 2024',
    body: 'AL remains first-line. Key change: extended artemether-lumefantrine course for high-risk patients.',
    tags: ['Infectious Disease', 'Protocol'],
    time: '2h ago',
    poll: null as string[] | null,
  },
  {
    type: 'cme',
    eyebrow: 'CME · 1.5 CPD hrs',
    title: 'ACS Management in Low-Resource Settings',
    body: 'Evidence-based approach to STEMI/NSTEMI when cath lab access is limited.',
    tags: ['Cardiology', 'Emergency'],
    time: '5h ago',
    poll: null as string[] | null,
  },
  {
    type: 'poll',
    eyebrow: 'Peer poll',
    title: "What's your first-line for hypertensive emergency in pregnancy?",
    body: null as string | null,
    tags: ['Obs & Gynae'],
    time: '1d ago',
    poll: ['Hydralazine IV', 'Labetalol IV', 'Nifedipine oral', 'MgSO₄'],
  },
];

const MOCK_POLL_RESULTS = [42, 31, 19, 8];

function PollOption({
  label,
  index,
  voted,
  myVote,
  onVote,
}: {
  label: string;
  index: number;
  voted: boolean;
  myVote: boolean;
  onVote: () => void;
}) {
  const pct = MOCK_POLL_RESULTS[index] ?? 0;

  if (voted) {
    return (
      <View style={[styles.pollOption, myVote && styles.pollOptionMine]}>
        <View style={styles.pollResultRow}>
          <Text style={[styles.pollOptionText, myVote && { color: Colors.navy }]}>{label}</Text>
          <Text style={[styles.pollPct, myVote && { color: Colors.navy }]}>{pct}%</Text>
        </View>
        <View style={styles.pollBarTrack}>
          <View style={[styles.pollBarFill, { width: `${pct}%` }, myVote && styles.pollBarMine]} />
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.pollOption} activeOpacity={0.75} onPress={onVote}>
      <Text style={styles.pollOptionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function FeedCard({
  item,
  itemIndex,
  votes,
  onVote,
}: {
  item: typeof FEED_ITEMS[0];
  itemIndex: number;
  votes: Record<number, number>;
  onVote: (itemIdx: number, optionIdx: number) => void;
}) {
  const isCme = item.type === 'cme';
  const voted = itemIndex in votes;

  return (
    <TouchableOpacity style={styles.feedCard} activeOpacity={item.poll ? 1 : 0.75}>
      <View style={styles.feedCardTop}>
        <Text style={[styles.feedEyebrow, isCme && { color: Colors.info }]}>{item.eyebrow}</Text>
        <Text style={styles.feedTime}>{item.time}</Text>
      </View>
      <Text style={styles.feedTitle}>{item.title}</Text>
      {item.body && <Text style={styles.feedBody}>{item.body}</Text>}
      {item.poll && (
        <View style={styles.pollOptions}>
          {item.poll.map((opt, i) => (
            <PollOption
              key={i}
              label={opt}
              index={i}
              voted={voted}
              myVote={votes[itemIndex] === i}
              onVote={() => onVote(itemIndex, i)}
            />
          ))}
          {voted && (
            <Text style={styles.pollCount}>142 responses</Text>
          )}
        </View>
      )}
      <View style={styles.feedTags}>
        {item.tags.map((t, i) => (
          <View key={i} style={styles.feedTag}>
            <Text style={styles.feedTagText}>{t}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );
}

export default function FeedScreen() {
  const [votes, setVotes] = useState<Record<number, number>>({});

  function handleVote(itemIdx: number, optionIdx: number) {
    if (itemIdx in votes) return;
    setVotes(prev => ({ ...prev, [itemIdx]: optionIdx }));
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Evidence Feed</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {FEED_ITEMS.map((item, i) => (
          <FeedCard
            key={i}
            item={item}
            itemIndex={i}
            votes={votes}
            onVote={handleVote}
          />
        ))}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgBase },
  header: { paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s3 },
  screenTitle: { fontFamily: Fonts.display, fontSize: FontSizes.h1, color: Colors.navy },
  scrollContent: { padding: Spacing.s4, gap: Spacing.s3 },
  feedCard: {
    backgroundColor: Colors.bgElevated,
    borderRadius: Radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderDefault,
    gap: Spacing.s2,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  feedCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feedEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.eyebrow,
    color: Colors.purple,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  feedTime: { fontFamily: Fonts.sans, fontSize: FontSizes.eyebrow, color: Colors.textMuted },
  feedTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.body, color: Colors.navy, lineHeight: 21 },
  feedBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySm, color: Colors.textSecondary, lineHeight: 19 },
  pollOptions: { gap: 6 },
  pollOption: {
    padding: 10,
    borderRadius: Radii.button,
    borderWidth: 1.5,
    borderColor: Colors.borderDefault,
    backgroundColor: Colors.bgBase,
    gap: 6,
  },
  pollOptionMine: {
    borderColor: Colors.purple,
    backgroundColor: Colors.bgNavyWash,
  },
  pollResultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pollOptionText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySm, color: Colors.textPrimary },
  pollPct: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySm, color: Colors.textSecondary },
  pollBarTrack: {
    height: 4,
    backgroundColor: Colors.bgSurface,
    borderRadius: 2,
    overflow: 'hidden',
  },
  pollBarFill: { height: '100%', backgroundColor: Colors.borderDefault, borderRadius: 2 },
  pollBarMine: { backgroundColor: Colors.purple },
  pollCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.eyebrow,
    color: Colors.textMuted,
    marginTop: 2,
  },
  feedTags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: Spacing.s1 },
  feedTag: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Radii.chip,
    backgroundColor: Colors.bgNavyWash,
  },
  feedTagText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.eyebrow, color: Colors.info },
});
```

- [ ] **Step 2: Verify in Expo Go**

1. Navigate to the Feed tab.
2. Tap any poll option — option highlights navy, percentage bars appear, "142 responses" count shows.
3. Tapping the already-voted poll again does nothing (vote is locked).
4. The voted option shows a purple fill bar; other options show grey bars.

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/feed.tsx
git commit -m "feat: add interactive poll voting with percentage reveal to feed screen"
```

---

## Task 8: learn.tsx — module navigation to case screen

**Files:**
- Modify: `app/(tabs)/learn.tsx`

Module card taps currently do nothing. Add `router.push('/case')` so tapping an unlocked module navigates to the MCQ demo case screen.

- [ ] **Step 1: Add router import and navigation to learn.tsx**

At the top of `app/(tabs)/learn.tsx`, add the router import:

```tsx
import { router } from 'expo-router';
```

Change `ModuleCard` to accept and use `onPress`:

```tsx
function ModuleCard({ mod, onPress }: { mod: typeof MODULES[0]; onPress?: () => void }) {
  const progress = mod.cases > 0 ? mod.done / mod.cases : 0;
  const complete = mod.done === mod.cases;

  return (
    <TouchableOpacity
      style={[styles.moduleCard, mod.locked && styles.moduleCardLocked]}
      activeOpacity={mod.locked ? 1 : 0.75}
      onPress={mod.locked ? undefined : onPress}
    >
```

In `LearnScreen`, pass the handler:

```tsx
{MODULES.map(mod => (
  <ModuleCard
    key={mod.id}
    mod={mod}
    onPress={() => router.push('/case')}
  />
))}
```

- [ ] **Step 2: Verify in Expo Go**

1. Navigate to the Learn tab.
2. Tap an unlocked module card (any without the lock icon) — navigates to the MCQ case screen.
3. Tap the locked module (opacity 0.6) — nothing happens, no navigation.
4. In the case screen, tap "Next case" (or use the back gesture) — returns to the Learn tab.

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/learn.tsx
git commit -m "feat: navigate to case screen on module tap in learn screen"
```

---

## Self-Review

### Spec Coverage

| CLAUDE.md / production requirement | Task |
|---|---|
| `supabase.auth.signUp` on register | Task 1 |
| Loading state + inline error on register | Task 1 |
| "Already have an account?" link | Task 1 |
| No `Colors.pink` on onboarding screens | Tasks 2, 6 |
| Reanimated chip spring on specialty | Task 2 |
| `supabase.from('profiles').upsert` for specialties | Task 2 |
| Reanimated spinner (not RN core `Animated`) | Task 3 |
| Controlled KMPDC input (value + onChangeText) | Task 3 |
| `supabase.from('profiles').upsert` for kmpdc_number | Task 3 |
| Skip path navigates without saving | Task 3 |
| `Skeleton` shimmer component | Task 4 |
| Screen entry animation (opacity + translateY, 280ms) | Tasks 1, 2, 3 |
| All buttons use `Button` component (Reanimated spring) | Tasks 1, 2, 3 |
| Real user greeting in ask screen | Task 5 |
| Skeleton loading state in ask screen | Task 5 |
| Submittable ask input | Task 5 |
| Real suggestion icons (not empty Views) | Task 5 |
| Fix hardcoded hex colors in ask screen | Task 5 |
| Real user profile loaded in me screen | Task 6 |
| Skeleton loading in me screen | Task 6 |
| Sign out action | Task 6 |
| Fix `pointerEvents` in style (RN warning) | Tasks 3, 6 |
| No `Colors.pink` in me screen (avatar border, tier eyebrow, progress fill) | Task 6 |
| Interactive poll votes with results | Task 7 |
| Module tap navigates to case | Task 8 |

### Placeholder Scan

No TBD, TODO, or "implement later" text. All code blocks are complete. Every style value uses a design token from `src/constants/`.

### Type Consistency

- `deriveDisplayName` and `deriveInitials` are defined identically in Tasks 5 and 6. Each file defines them locally — they are standalone and don't reference each other.
- `DURATION.screen`, `springConfig`, `Colors.*`, `Fonts.*`, `FontSizes.*`, `Spacing.*`, `Radii.*` — all imported from the same source files across all tasks.
- `supabase.auth.getUser()` return type: `{ data: { user: User | null } }` — handled with null checks in Tasks 5 and 6.
- `profile?.specialties?.[0]` — optional chaining used safely; profiles table row may not exist for new users.
- `width: \`${s.pct}%\`` in me.tsx specFill — valid `DimensionValue` string; TypeScript accepts this.
