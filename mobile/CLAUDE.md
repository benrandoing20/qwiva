# CLAUDE.md — Qwiva Mobile App

You are building **Qwiva** — a clinical decision support and CPD platform for healthcare providers in Kenya and East Africa. Quality bar: **Perplexity / Claude iOS level**. Every screen must feel like it was designed by a senior product team.

---

## 1. Known Landmines (read before suggesting any change)

These are real bugs and incidents that have already happened in this codebase. Do not suggest workarounds against them — work *with* them.

1. **New Architecture must stay disabled.** `newArchEnabled: false` in `app.json`. Required for stable `TextInput` focus on Expo Go SDK 54 + RN 0.81.5. Do not suggest enabling it.

2. **Reanimated must stay at `~4.1.1`.** Expo Go SDK 54 bundles Reanimated 4.1.1 + `react-native-worklets` 0.5.1 natively. Downgrading to v3.x crashes immediately with `installTurboModule`.

3. **Never use `Animated` from `react-native`.** Always `react-native-reanimated`. Mixing the two causes silent inconsistency in transition timing.

4. **Never run `npm install` with no args.** It can re-resolve the dependency tree and drift Expo modules to SDK 55, which Expo Go SDK 54 cannot run. The repo has a `sdk54-baseline` git tag that captures the known-good tree. See section 3.

5. **Pink (`Colors.pink`) is a decorative brand accent — use it sparingly.** Acceptable on icons, illustrations, and small decorative elements across any screen. NOT acceptable as the primary color of interactive elements (button fills, active states, check marks) on onboarding or tab chrome — those should use Navy or Purple. The gamification surfaces (pulse, me, case) should lean on `Colors.xpGold`, `Colors.streakFire`, and `Colors.heartRed` for their dedicated semantic meaning, not pink.

6. **Gotham and Gilroy are local OTF files** in `assets/`, not Google Fonts. Loaded via `expo-font`. Do not suggest installing `@expo-google-fonts/gotham` — that package does not exist.

7. **Expo Go on iPhone is locked to SDK 54** by App Store availability. Any change that requires SDK 55, a config plugin, or a custom dev client must be flagged before implementation, not after.

8. **`react-dom` is pinned to `19.1.0`** to match `react@19.1.0`. This resolves a peer dependency conflict with `expo-router` that surfaced when adding `expo-haptics`. The pin is not optional — removing it breaks `npm install`.

---

## 2. Tech Stack (actual versions from package.json)

| Layer | Package | Version |
|---|---|---|
| Framework | expo | ~54.0.33 |
| Language | typescript | ~5.9.2 (strict mode) |
| Runtime | react-native | 0.81.5 |
| React | react | 19.1.0 |
| React DOM | react-dom | 19.1.0 (peer pin) |
| Navigation | expo-router | ~6.0.23 |
| Animations | react-native-reanimated | ~4.1.1 |
| Worklets runtime | react-native-worklets | 0.5.1 |
| Haptics | expo-haptics | ~15.0.8 |
| Icons | lucide-react-native | ^1.8.0 |
| Auth + DB | @supabase/supabase-js | ^2.104.0 |
| Auth storage | @react-native-async-storage/async-storage | 2.2.0 |
| Fonts (serif) | @expo-google-fonts/lora | ^0.4.2 |
| Fonts (mono) | @expo-google-fonts/jetbrains-mono | ^0.4.1 |
| SVG | react-native-svg | 15.12.1 |
| Blur | expo-blur | ~15.0.8 |
| Safe area | react-native-safe-area-context | ~5.6.0 |
| Screens | react-native-screens | ~4.16.0 |

**Architecture flag:** `newArchEnabled: false` in `app.json`. **Do not change.**

**Supabase MCP:** Active MCP connection to project `qwiva-app` (ID: `ftjykxbcyjxtvvweessa`, region: eu-west-1). Use MCP tools for schema inspection, migrations, and SQL queries against the live database.

---

## 3. Dependency Management — HARD RULES

The committed `package-lock.json` is the source of truth and is pinned to SDK 54-compatible versions. Breaking it has cost real time. The git tag `sdk54-baseline` captures the known-good tree for emergency restore.

### Allowed commands

- `npx expo install <package>` — always for any package containing native code (Expo modules, react-native-* libraries).
- `npm install <pure-js-package>` — only for packages with no native code (e.g. `zod`, `date-fns`).
- `npm ci` — clean reinstall from lock file. Use this on fresh clones.

### Forbidden commands (will break the project)

- `npm install` (no args) — can silently re-resolve and drift Expo modules.
- `npm update` — bumps past lock.
- `npm audit fix` — bumps past lock.
- `npx expo install --fix` — only run on explicit user request.
- `yarn` (anything) — this project is npm-only.

### Adding a new package — required protocol

1. Confirm it is Expo Go compatible. Flag if it would require a dev build.
2. Use `npx expo install` if it has native code; `npm install <pkg>` only if pure-JS.
3. Immediately after install, run `git diff package.json package-lock.json`.
4. Verify **only the new package was added** — no other versions changed.
5. If other versions changed, **STOP** and report to the user before continuing. Do not commit.

### Recovery if the tree drifts

```powershell
git checkout sdk54-baseline -- package.json package-lock.json
Remove-Item -Recurse -Force node_modules
npm ci
```

---

## 4. Change Protocol

For any change touching more than 2 files, OR any change that adds a dependency, OR any change to config files (`app.json`, `tsconfig.json`, `package.json`, `babel.config.js`, etc.):

1. **Show the plan first** — list the files to touch and what will change in each.
2. **Wait for confirmation** before executing.
3. **Make changes one file at a time.** After each file, briefly note what changed.
4. **After all changes, show `git status` and `git diff --stat`.**
5. **Never run `git commit`** — the user commits manually.

For trivial changes (single-file fix, typo, comment), this protocol may be skipped, but show the diff at the end.

---

## 5. Git Discipline

- **Never run** `git commit`, `git push`, `git tag`, `git reset --hard`, `git checkout` (with a destination), `git restore .`, or any command that mutates branches or rewrites history. The user manages git.
- **You may run** read-only git commands: `git status`, `git diff`, `git log`, `git ls-files`, `git show`.
- After making changes, summarise them and show `git status`.
- If a change is destructive (deleting a directory, rewriting a config, regenerating a lock file), warn explicitly and wait for confirmation.

---

## 6. Path Conventions

- **Routable screens:** `app/` (Expo Router file-based routing).
- **Everything else:** `src/`
  - `src/components/ui/` — design-system primitives.
  - `src/hooks/` — custom hooks.
  - `src/lib/` — utilities, clients, helpers.
  - `src/constants/` — design tokens.
- **Path alias:** `@/*` resolves to `src/*` (configured in `tsconfig.json`).
- **Always use `@/` imports**, never relative `../../`. Files predating this rule may still use relative imports (e.g. `rotation.tsx`); fix them when next touched.

---

## 7. Secrets

- `.env` is gitignored. Never commit it. Never paste real values into any file you edit — placeholders only.
- Never run commands that print env values to logs (e.g. `echo $EXPO_PUBLIC_SUPABASE_URL`).
- If you need to reference a secret in code, reference it via `process.env.EXPO_PUBLIC_*`. Never inline.

---

## 8. Design System

All tokens live in `src/constants/`. Never hardcode a value in a component — always import.

### Colors (`src/constants/colors.ts`)

```ts
// Core Brand
navy:    '#002E5D'   // Primary — dominant surfaces, headers, primary buttons
purple:  '#6F5091'   // CTAs, active states, tier Oracle
lilac:   '#B288B9'   // Accents, secondary badges, tier Clinician badge
pink:    '#D988BA'   // Decorative accent — icons, illustrations, small flourishes. Not for active states or button fills.

// Surfaces
bgBase:      '#FAFAFA'   // Screen backgrounds
bgSurface:   '#F4F4F6'   // Subtle containers
bgElevated:  '#FFFFFF'   // Cards, inputs
bgNavyWash:  '#EEF3F9'   // Light navy tint, user bubbles

// Text
textPrimary:   '#1A1A2E'
textSecondary: '#5C5C7A'
textMuted:     '#9999B3'
textInverse:   '#FFFFFF'

// Semantic
success: '#2D9E6B'  successWash: '#E8F7F1'
warning: '#D97706'  warningWash: '#FEF3C7'
danger:  '#C0405A'  dangerWash:  '#FDEEF1'
info:    '#4764AF'  infoWash:    '#EEF2FA'

// Interactive
purpleHover:    '#5D4179'
purpleDisabled: '#B8A8CC'
navyPressed:    '#001E3C'
borderDefault:  '#E2E2EC'
borderFocus:    '#6F5091'

// Gamification (use ONLY on pulse/me/case screens — never onboarding or tab chrome)
xpGold:    '#F5A623'
streakFire: '#FF6B35'
heartRed:  '#E84545'
tierOracle:    '#6F5091'
tierClinician: '#4764AF'
tierHealer:    '#2D9E6B'
```

### Typography (`src/constants/typography.ts`)

Gotham and Gilroy are **local OTF files** in `assets/` (not from Google Fonts). Lora and JetBrains Mono are loaded via `@expo-google-fonts/*` packages.

```ts
// Lora — display/headlines (all screens)
Fonts.display        = 'Lora_700Bold'         // Headlines, emotional weight
Fonts.displayMedium  = 'Lora_600SemiBold'     // Sub-headlines
Fonts.displayItalic  = 'Lora_400Regular_Italic'  // Italic headlines

// Gotham — sans-serif for everything except headlines and landing wordmark/tagline
Fonts.sans           = 'Gotham-Book'           // Body, labels, inputs
Fonts.sansMedium     = 'Gotham-Medium'         // Emphasis
Fonts.sansBold       = 'Gotham-Bold'           // Strong labels, CTAs, buttons
Fonts.sansBlack      = 'Gotham-Black'          // Marketing display

// JetBrains Mono — clinical data
Fonts.mono           = 'JetBrainsMono_400Regular'  // Lab values, doses, codes

// Gilroy — landing screen ONLY, never used elsewhere
Fonts.gilroySemiBold = 'Gilroy-SemiBold'      // Landing wordmark ("qwiva") only
Fonts.gilroyLight    = 'Gilroy-Light'          // Landing tagline only

FontSizes: display=34 h1=28 h2=22 h3=18 body=15 bodySm=13 label=12 eyebrow=11 mono=11
```

### Spacing (`src/constants/spacing.ts`)

```ts
Spacing: s1=4 s2=8 s3=12 s4=16 s5=20 s6=24 s7=28 s8=32 s10=40 s12=48 s16=64 gutter=16
Radii:   chip=6 button=10 card=14 sheet=20 hero=28 pill=999
```

---

## 9. Directory Tree (actual)

```
qwiva_mobile_app/
├── app/
│   ├── _layout.tsx              Root layout — font loading, Stack navigator, auth listener
│   ├── index.tsx                Session check → /(tabs)/ask or /onboarding
│   ├── case.tsx                 Clinical MCQ screen
│   ├── onboarding/
│   │   ├── _layout.tsx          Onboarding Stack (slide_from_right + full-screen swipe-back)
│   │   ├── index.tsx            01 · Landing — sign up / log in
│   │   ├── register.tsx         02 · Registration — name, email, password (step 1/4)
│   │   ├── phone.tsx            03 · Phone verification — country code (step 2/4)
│   │   ├── verify.tsx           04 · Cadre + licence — radio selector + reg number (step 3/4)
│   │   ├── specialty.tsx        05 · Specialty chips — filtered by cadre (step 4/4, non-Intern)
│   │   ├── rotation.tsx         06 · Rotation picker — Intern-only (step 4/4, replaces specialty)
│   │   └── login.tsx            Sign-in screen
│   └── (tabs)/
│       ├── _layout.tsx          Tab bar (BlurView on iOS, opaque on Android)
│       ├── ask.tsx              Ask home — query surface
│       ├── feed.tsx             Evidence feed
│       ├── learn.tsx            CPD modules
│       ├── pulse.tsx            Stats + leaderboard
│       └── me.tsx               Profile + tier
├── assets/
│   ├── logo-mark.png            2×2 square logo
│   └── Gotham-*.otf             7 weights: Thin Light Book Medium Bold Black Ultra
├── src/
│   ├── components/ui/
│   │   ├── Badge.tsx
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Eyebrow.tsx
│   │   ├── Input.tsx
│   │   ├── QwivaLogo.tsx
│   │   └── Skeleton.tsx         shimmer loader (Reanimated, no LinearGradient)
│   ├── constants/
│   │   ├── colors.ts
│   │   ├── spacing.ts
│   │   ├── typography.ts
│   │   └── index.ts
│   ├── hooks/
│   │   ├── useFonts.ts          useQwivaFonts() — loads ALL fonts incl. Lora + JetBrains
│   │   └── useShake.ts          horizontal shake animation (Reanimated)
│   └── lib/
│       ├── supabase.ts          Supabase client (AsyncStorage auth)
│       ├── analytics.ts         dev-only track() wrapper
│       ├── motion.ts            DURATION constants
│       ├── routing.ts           getPostAuthRoute(userId) helper
│       └── haptics.ts           tapHaptic / successHaptic / errorHaptic / selectionHaptic
├── app.json                     newArchEnabled: false, plugins: [expo-router, expo-font]
├── index.ts                     expo-router/entry
├── package.json
├── tsconfig.json                strict: true, paths: @/* → src/*
└── CLAUDE.md
```

**Does not exist yet (must be created):**
- `src/hooks/useAuth.ts`
- `.env` — copy from `.env.example` and fill values

---

## 10. Component Inventory (`src/components/ui/`)

| File | What it does | Gaps |
|---|---|---|
| `Button.tsx` | 5 variants (primary/navy/ghost/danger/outline), 3 sizes, loading state via ActivityIndicator | No Reanimated press animation |
| `Badge.tsx` | 9 semantic variants mapping to wash+text color pairs, uppercase | Complete |
| `Card.tsx` | bgElevated, Radii.card, card shadow, optional elevated/noPadding | Complete |
| `Eyebrow.tsx` | Uppercase label, Fonts.sansBold, letterSpacing 1.5, configurable color | Complete |
| `Input.tsx` | focus state (purple border + shadow), label, hint, mono mode | No error state, no password toggle |
| `QwivaLogo.tsx` | 2×2 SVG grid: Navy/Purple/Lilac/Pink rectangles | Complete |
| `Skeleton.tsx` | shimmer loader — Reanimated `withRepeat`, no LinearGradient | Complete |

---

## 11. Screen Status

| Screen | Status | What's missing |
|---|---|---|
| `onboarding/index.tsx` | Partial | Landing screen — buttons wired with haptics. Missing: Reanimated entry animation (logo scale, CTA stagger). |
| `onboarding/register.tsx` | Partial | Supabase `signUp` + profile upsert wired, haptics + shake done, loading state done. Missing: social login row (Google/Apple), password visibility toggle. |
| `onboarding/phone.tsx` | Partial | Country picker + phone save to `profiles` + haptics done. OTP flow paused pending paid Supabase phone provider — Twilio sandbox tested but SMS delivery unreliable. Currently saves the number without verification. |
| `onboarding/verify.tsx` | Partial | Cadre cards, reg input + pattern validation, Supabase upsert, haptics + shake done. Routes Intern → `rotation.tsx`, others → `specialty.tsx`. |
| `onboarding/rotation.tsx` | Partial | Intern-only rotation picker, Supabase save to `current_rotation`. Missing: haptics, Reanimated. Violations: `console.error`, `../../src/constants` import path. Pink on checks/dots — verify intent (pink as active-state fill is unusual). |
| `onboarding/specialty.tsx` | Partial | Supabase save + cadre filtering done. Missing: haptics, Reanimated chip springs. Pink on icons is intentional (decorative); pink on checks should be reviewed. |
| `onboarding/login.tsx` | Partial | Supabase signIn, Reanimated entry + shake, haptics done. Missing: "Forgot password?" link. |
| `(tabs)/ask.tsx` | Partial | All mock data; floating input doesn't submit; no answer view; suggestion icons are empty Views. Violations: hardcoded hex `#FFF2E5`, `rgba(242,140,49,0.25)`, `#D4721B`. |
| `(tabs)/feed.tsx` | Partial | All mock data; poll votes not interactive. |
| `(tabs)/learn.tsx` | Partial | All mock data; module tap does nothing. |
| `(tabs)/pulse.tsx` | Partial | All mock data. |
| `(tabs)/me.tsx` | Partial | Real Supabase data + Skeleton loading + sign out wired. Stats row permanently skeleton (no XP backend). |
| `(tabs)/_layout.tsx` | Partial | Tab bar with BlurView/opaque. Violation: `any` TypeScript on Icon prop. |
| `app/case.tsx` | Partial | All mock data; functional MCQ loop works. Violation: hardcoded `#FFE5E5` in heartsPill. |
| `app/_layout.tsx` | Done | Lora + JetBrains loaded via `useQwivaFonts`. Auth listener handles `SIGNED_OUT` (routes to `/onboarding`). `SIGNED_IN` events are not handled here by design — every flow that produces a `SIGNED_IN` (login, OAuth, signup, password reset) navigates explicitly via `getPostAuthRoute`. Cold-start session check happens in `app/index.tsx`. The deep link handler in `_layout.tsx` routes password reset URLs to `/onboarding/reset-password`. |
| `app/index.tsx` | Done | `getSession()` + `getPostAuthRoute()` wired. |

---

## 12. Dependencies Status

All five are **already installed** in package.json:

```
react-native-reanimated             ~4.1.1   ✓ installed
react-native-worklets               0.5.1    ✓ installed
expo-haptics                        ~15.0.8  ✓ installed
@supabase/supabase-js               ^2.104.0 ✓ installed
@react-native-async-storage/async-storage  2.2.0  ✓ installed
```

### Reanimated configuration

Use `~4.1.1`. Expo Go SDK 54 bundles Reanimated 4.1.1 + `react-native-worklets` 0.5.1 natively. Both packages must be in `node_modules` so the JS layer resolves correctly (native code is already in Expo Go). **Do NOT downgrade to v3.x** — it crashes with `installTurboModule` because Expo Go SDK 54's native module is v4. `app.json` plugins stay as `["expo-router", "expo-font"]` — no Reanimated plugin entry needed.

### Haptics utility

`src/lib/haptics.ts` exports four functions:

```ts
tapHaptic()       // Haptics.impactAsync(Light) — buttons, taps
successHaptic()   // Haptics.impactAsync(Medium) — successful submit, completion
errorHaptic()     // Haptics.notificationAsync(Error) — validation/auth failures
selectionHaptic() // Haptics.selectionAsync() — list/picker selection (radio cards, country rows, segmented controls)
```

Pair `errorHaptic()` with `shake()` (from `useShake`) on validation and Supabase errors. Use `selectionHaptic` not `tapHaptic` when the user is choosing from a list of options — it matches iOS picker semantics.

### Shake animation

`src/hooks/useShake.ts` returns `{ shakeX, shake }`. Bind `shakeX` to a parent `Animated.View`'s `transform: [{ translateX }]` via `useAnimatedStyle`. Call `shake()` to trigger the symmetric −8/+8/−8/+8/−6/+6/0 oscillation (~320ms total).

### Supabase client

`src/lib/supabase.ts` already created:

```ts
import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
)
```

### Environment

`.env.example` exists. Copy to `.env` and fill:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 13. Design & Quality Rules (consolidated)

### Code

- **No hardcoded hex values** — always import from `src/constants/colors.ts`. Existing violations: `(tabs)/ask.tsx`, `app/case.tsx` — fix when next touched.
- **No inline styles** — always `StyleSheet.create()`.
- **No `any` TypeScript types** — infer where possible, otherwise type explicitly. Existing violation: `(tabs)/_layout.tsx`.
- **No `console.log` or `console.error`** in committed code. Existing violations: `register.tsx`, `phone.tsx`, `verify.tsx`, `rotation.tsx`.
- **No `alert()`** for errors — render error states inline in the UI.

### Colour

- **Pink (`Colors.pink`) is a decorative accent**, fine on icons and small flourishes anywhere in the app. Avoid it as the primary fill of interactive elements (button backgrounds, selection chip fills) — use Navy or Purple for those.
- Gamification surfaces (`pulse.tsx`, `me.tsx`, `app/case.tsx`) should use `Colors.xpGold`, `Colors.streakFire`, and `Colors.heartRed` for XP, streaks, and achievements — these are the dedicated semantic tokens.

### Animations

- **All animations via `react-native-reanimated` only** — never `Animated` from `react-native`.
- **Spring config (default):** `{ damping: 20, stiffness: 300, mass: 0.8 }`.
- **Every button press:** `withSpring` scale `0.96 → 1.0`.
- **Micro-interactions:** 120ms | **Screen transitions:** 280ms | **Staggered content reveals:** 60ms between items.
- Never `setTimeout` for animation sequencing — use `withSequence` or `withDelay`.

### Haptics

- **Buttons** → `tapHaptic()` synchronously in `onPress`, before any other action.
- **List/picker selection** (radio cards, country rows, cadre cards, segmented controls) → `selectionHaptic()` — NOT `tapHaptic`.
- **Form submit success** → `successHaptic()` after the API confirms, before navigation.
- **Validation or API failure** → `errorHaptic()` together with `shake()` on the form section.
- Do not haptic on input focus, typing, scroll, or screen entry animations.

### Layout

- **Minimum touch target:** 48pt height on all interactive elements.
- **No full-screen spinners** (`ActivityIndicator` alone) — use Skeleton loaders.
- Skeleton shape must match the content it replaces, with **shimmer** (not pulse).

### Done criteria

Before any screen is marked Done:

1. Animations are spring-based and smooth at 60fps (Reanimated only).
2. All states are designed: loading (skeleton), error (inline), empty.
3. Every touch target is ≥ 48pt height.
4. Layout is tested on iPhone SE (small) and iPhone 15 Pro Max (large).
5. No hardcoded colors, no inline styles, no `any` types, no `console.*` calls.
6. No pink on non-gamification surfaces.
7. Haptics applied per the rules above.

---

## 14. Onboarding Flow — Phase 1 (Current Priority)

### User journey

```
landing → register → phone → verify ─┬→ specialty → (tabs)/ask     (non-Intern)
                                     └→ rotation  → (tabs)/ask     (Intern)
```

The Intern path diverges at `verify.tsx`: cadre = "Intern" navigates to `rotation.tsx`, all other cadres navigate to `specialty.tsx`. Both end at `(tabs)/ask`.

### Auth routing (`app/_layout.tsx` + `app/index.tsx`)

- On mount: check `supabase.auth.getSession()`.
- Session exists → redirect to `/(tabs)/ask`.
- No session → redirect to `/onboarding` (landing screen).
- Listen to `supabase.auth.onAuthStateChange` for runtime changes.

### Supabase auth calls

| Screen | Action |
|---|---|
| `register.tsx` | `supabase.auth.signUp({ email, password })` + `supabase.from('profiles').upsert({ first_name, last_name })` → navigate to `phone` |
| `phone.tsx` | (Currently) save phone to `profiles`. (Spec target) Supabase phone OTP via `signInWithOtp` + `verifyOtp` → navigate to `verify` |
| `verify.tsx` | `supabase.from('profiles').upsert({ cadre, registration_number })` → navigate to `specialty` (non-Intern) or `rotation` (Intern) |
| `specialty.tsx` | `supabase.from('profiles').upsert({ specialties: selected })` → navigate to `(tabs)/ask` |
| `rotation.tsx` | `supabase.from('profiles').upsert({ current_rotation: selected })` → navigate to `(tabs)/ask` |

### Profiles table schema

```sql
CREATE TABLE profiles (
  id                  uuid        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  first_name          text,
  last_name           text,
  phone               text,
  cadre               text        CHECK (cadre IN ('Medical Practitioner', 'Clinical Officer', 'Dental Practitioner', 'Intern')),
  registration_number text,
  specialties         text[]      DEFAULT '{}',
  current_rotation    text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
```

### Screen specs

**onboarding/index.tsx** (landing)
- QwivaLogo + wordmark centred.
- Tagline: *"The smartest colleague you've ever had."* (Gilroy light).
- Primary CTA: "Create account" → `register`.
- Ghost CTA: "Log in" → `login`.
- Animated entry: logo scale 0.85→1 + opacity 0→1 with `withSpring`; CTAs staggered 60ms after logo.

**register.tsx** (step 1 of 4)
- Fields: First name, Last name, Email, Password (secureTextEntry + toggle eye icon).
- Social row: "Continue with Google" + "Continue with Apple" buttons (outline variant, icons via lucide).
- Divider: "or" between social row and manual fields.
- `supabase.auth.signUp({ email, password })` on submit.
- On success: `supabase.from('profiles').upsert({ id: user.id, first_name, last_name })`.
- Loading state on button during API call.
- Inline error below form (not alert).
- "Already have an account? Sign in" link → `login`.

**phone.tsx** (step 2 of 4)
- Headline: *"What's your phone number?"* (Lora display).
- Subtitle: *"We'll use this to reach you about your account."*
- Country code picker (default 🇰🇪 +254, modal sheet with search) + phone number input side by side.
- "Continue" button saves phone to `profiles`.
- (Spec target — not yet implemented) On send-code: input transitions to 6-digit OTP entry (6 individual boxes, Reanimated focus spring), auto-advance, "Resend code" with 30-second cooldown.

**verify.tsx** (step 3 of 4)
- Headline: *"Tell us about your practice."*
- Cadre selector — 4 radio cards, each with icon + label:
  - **Medical Practitioner** — Stethoscope icon
  - **Clinical Officer** — Activity icon
  - **Dental Practitioner** — SmilePlus icon
  - **Intern** — GraduationCap icon
- Dynamic input below cadre selection — label and placeholder change per cadre:

| Cadre | Label | Placeholder | Pattern |
|---|---|---|---|
| Medical Practitioner | KMPDC Registration No. | e.g. A35671 | `/^[Aa]\d{4,5}$/` |
| Clinical Officer | COC Licence Number | e.g. Rd02177/25 | `/^[A-Za-z]{1,3}\d{3,6}\/\d{2}$/` |
| Dental Practitioner | KMPDC Registration No. | e.g. B10234 | `/^[Bb]\d{4,5}$/` |
| Intern | KMPDC Intern Licence No. | e.g. 92000 | `/^\d{5}$/` |

- **Hard gate**: "Continue" is disabled until cadre is selected AND reg number matches pattern. No skip option.
- Cadre selection uses `selectionHaptic()` (matches iOS picker semantics).
- On success: navigate to `specialty` (non-Intern) or `rotation` (Intern).

**specialty.tsx** (step 4 of 4 — non-Intern)
- Headline: *"What do you see most?"*
- Subtitle: *"Pick up to 3 specialties. Your feed and CPD adapt to these."*
- Chip grid filtered by cadre from profile — specialty lists:

| Cadre | Specialty options |
|---|---|
| Medical Practitioner | Internal Medicine, Surgery, Paediatrics, Obs & Gynae, Family Medicine, Emergency Medicine, Psychiatry, Radiology, Anaesthesia, Cardiology, Neurology, Nephrology, Gastroenterology, Endocrinology, Pulmonology, Oncology, Dermatology, Ophthalmology, ENT, Urology |
| Clinical Officer | General Practice, Emergency Care, Paediatrics, Anaesthesia, Orthopaedics, Ophthalmology, ENT, Psychiatry, Reproductive Health |
| Dental Practitioner | General Dentistry, Oral Surgery, Orthodontics, Prosthodontics, Periodontics, Paediatric Dentistry |

- Max 3 selections.
- Chip selected state: Navy fill + white text + `withSpring` scale.
- Use `Colors.purple` or `Colors.lilac` for icons — never `Colors.pink`.
- "Continue" enabled when ≥ 1 chip selected; "Skip for now" ghost link also available.
- Chip selection should use `selectionHaptic()`.
- `supabase.from('profiles').upsert({ specialties: selected })` → navigate to `(tabs)/ask`.

**rotation.tsx** (step 4 of 4 — Intern only)
- Headline: *"Where are you rotating right now?"*
- Subtitle: *"We'll surface guidelines, cases, and CPD modules tailored to your current rotation."*
- Single-select rotation picker (e.g. Internal Medicine, Surgery, Paediatrics, Obs & Gynae, Emergency, Psychiatry, etc.).
- Selected state: Navy fill + white text.
- Use `Colors.purple` or `Colors.lilac` for icons — never `Colors.pink` (currently violating).
- Selection should use `selectionHaptic()`.
- `supabase.from('profiles').upsert({ current_rotation: selected })` → navigate to `(tabs)/ask`.

### Animation patterns (apply to all onboarding screens)

**Screen entry pattern**

Every onboarding screen wraps its content in a container that animates on mount:

```ts
// Container
opacity: 0 → 1, translateY: 24 → 0
duration: 280ms, withTiming + Easing.out(Easing.quad)

// Content items — stagger each child by 60ms
item[0]: delay 0ms
item[1]: delay 60ms
item[2]: delay 120ms
// ... etc.
// Use useAnimatedStyle + withDelay(n * 60, withTiming(...)) for each element
```

**List / chip grid entry pattern**

Any rendered list or chip grid: items enter with staggered `withSpring`:

```ts
item[0]: delay 0ms,   scale 0.92→1, opacity 0→1
item[1]: delay 50ms,  scale 0.92→1, opacity 0→1
item[2]: delay 100ms, scale 0.92→1, opacity 0→1
// Each subsequent item: +50ms delay
// Spring config: { damping: 20, stiffness: 300, mass: 0.8 }
```

**Form shake pattern**

The form section of every input-bearing screen is wrapped in `<Animated.View style={[styles.formGroup, shakeStyle]}>` where `shakeStyle` is a `useAnimatedStyle` reading from `useShake`'s `shakeX`. Call `shake()` in the same path as `errorHaptic()`.

---

## 15. Verification After Changes

After any non-trivial change, the agent should **remind the user** to run the appropriate verification commands. The agent should **not run these automatically** — only suggest.

| Change type | User should run |
|---|---|
| Any source change | `npx expo start --go --clear` and reload Expo Go |
| TypeScript change | `npx tsc --noEmit` to verify types |
| Dependency change | `npx expo-doctor` to verify alignment |
| Config change (`app.json`, `babel.config.js`) | Full restart: `npx expo start --go --clear` |
| New native module | Verify it appears in Expo Go without a dev build |

---

## 16. Build Phases

### Phase 1 — Onboarding Flow (CURRENT)

**Done:** Auth routing, profiles table + RLS, fonts loading, all six onboarding screens existing and reachable, haptics + shake on landing/register/phone/verify/login.

**Remaining:**
- Add haptics + Reanimated polish to `specialty.tsx` and `rotation.tsx`.
- Fix pink-on-icon violations in `specialty.tsx` and `rotation.tsx`.
- (Paused) Full OTP flow in `phone.tsx` — requires paid Supabase phone provider with reliable SMS delivery. Twilio sandbox produced sent-but-not-received messages.
- Add social login row + password toggle to `register.tsx`.
- Add "Forgot password?" link to `login.tsx`.
- Fix `_layout.tsx` auth listener to handle `SIGNED_IN` events.

### Phase 2 — Ask Tab and tab screens

RAG query surface with streaming answer experience, source citation chips, real-time response rendering. Currently all mock data.

**Deferred cleanups bundled into Phase 2.** The following violations are deliberately not fixed during Phase 1 cleanup passes — they will be addressed when each screen is wired to real data:

- `(tabs)/_layout.tsx` — `any` type on Icon prop
- `(tabs)/ask.tsx` — hardcoded hex (`#FFF2E5`, `rgba(242,140,49,0.25)`, `#D4721B`)
- `app/case.tsx` — hardcoded hex (`#FFE5E5` in heartsPill)

Do not "helpfully" fix these as part of any Phase 1 cleanup pass — fixing them now means doing the work twice once the screens are restructured.

---

## 17. Testing Approach

**Developer machine:** Windows
**Test device:** iPhone with Expo Go installed (App Store version, locked to SDK 54)

We use Expo Go for all Phase 1 and Phase 2 development.

**Test command:**

```
npx expo start --go --clear
```

Then scan QR code with Expo Go app on iPhone.

### Rules

- All packages must be Expo Go compatible.
- Do NOT suggest `npx expo run:ios` (requires Mac).
- Do NOT suggest `npx expo run:android` unless asked.
- Do NOT suggest `eas build` during Phase 1 or Phase 2.
- Before adding any new package, confirm it is on the Expo Go compatible list at docs.expo.dev.
- Flag any feature that would require a dev build **before** implementing it — do not implement silently.

When a dev build is eventually needed (push notifications, biometrics, etc.) the approach will be EAS cloud build from Windows — not a local native build.