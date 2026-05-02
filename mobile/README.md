# Qwiva Mobile App

Clinical decision support and CPD platform for healthcare providers in Kenya and East Africa. Built with Expo Go (no custom native build required for development).

## Tech stack

| Layer | Package | Version |
|---|---|---|
| Framework | Expo | ~54.0.33 |
| Language | TypeScript | ~5.9.2 (strict) |
| Runtime | React Native | 0.81.5 |
| Navigation | Expo Router | ~6.0.23 |
| Auth + DB | Supabase | ^2.104.0 |
| Animations | React Native Reanimated | ~4.1.1 |
| Icons | Lucide React Native | ^1.8.0 |

**Architecture note:** New Architecture is disabled (`newArchEnabled: false`) — required for stable TextInput focus on Expo Go SDK 54 + RN 0.81.5.

## Quick start

```bash
npm install
cp .env.example .env   # fill in your Supabase URL and anon key
npx expo start --go
```

Scan the QR code with **Expo Go** on iOS or Android. Do not use `expo run:ios` or `expo run:android` during development — Expo Go covers all Phase 1 and Phase 2 features.

## Environment

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Project structure

```
app/
├── _layout.tsx              Root layout — loads all fonts, Stack navigator
├── index.tsx                Session check → /(tabs)/ask or /onboarding
├── case.tsx                 Clinical MCQ screen
├── onboarding/
│   ├── _layout.tsx          Onboarding Stack (slide_from_right)
│   ├── index.tsx            01 · Landing — Create account / Log in
│   ├── register.tsx         02 · Registration — name, email, password (step 1/4)
│   ├── phone.tsx            03 · Phone verification — OTP (step 2/4)
│   ├── verify.tsx           04 · Cadre + licence number (step 3/4)
│   ├── specialty.tsx        05 · Specialty chips, max 3 (step 4/4)
│   └── login.tsx            Sign-in screen
└── (tabs)/
    ├── ask.tsx              Ask home — clinical query surface
    ├── feed.tsx             Evidence feed
    ├── learn.tsx            CPD modules
    ├── pulse.tsx            Stats + leaderboard
    └── me.tsx               Profile + tier

src/
├── components/ui/           Button, Badge, Card, Input, Eyebrow, QwivaLogo
├── constants/               Design tokens — colors, typography, spacing, radii
├── hooks/useFonts.ts        useQwivaFonts() — loads all font families
└── lib/
    ├── supabase.ts          Supabase client (AsyncStorage session persistence)
    ├── analytics.ts         dev-only track() wrapper
    ├── motion.ts            Animation duration constants
    └── routing.ts           getPostAuthRoute() helper

assets/
├── logo-mark.png            Brain/puzzle logo mark (RGBA transparent)
├── Gilroy-Light.ttf         Landing tagline font
├── Gilroy-SemiBold.ttf      Landing wordmark font
└── Gotham-*.otf             7 weights: Thin Light Book Medium Bold Black Ultra
```

## Design system

Tokens in `src/constants/`. Never hardcode values — always import.

**Fonts**
- `Lora` — screen headlines (display serif)
- `Gotham` — all body, labels, inputs, buttons (UI sans)
- `JetBrains Mono` — lab values, doses, codes
- `Gilroy` — landing screen only (wordmark + tagline)

**Colours**
- Brand: Navy `#002E5D` · Purple `#6F5091` · Lilac `#B288B9`
- Gamification only: Pink `#D988BA` · XP Gold · Streak Fire · Heart Red
- Tier: Oracle = Purple · Clinician = Info blue · Healer = Success green

**Spacing:** 4pt grid (`s1`=4 … `s16`=64)  
**Radii:** chip 6 · button 10 · card 14 · sheet 20 · hero 28

## Onboarding flow

```
landing → register → phone → verify → specialty → (tabs)/ask
                                              ↑
                               skip if cadre = Intern
```

| Screen | Supabase call |
|---|---|
| register | `auth.signUp` → `profiles.upsert(first_name, last_name)` |
| phone | `auth.signInWithOtp({ phone })` → `auth.verifyOtp` |
| verify | `profiles.upsert(cadre, reg_number)` |
| specialty | `profiles.upsert(specialties[])` |

## Supabase setup

Project ID: `ftjykxbcyjxtvvweessa` (eu-west-1)

The `profiles` table and RLS policies are already created. For development, disable email confirmation in **Authentication → Providers → Email** so `signUp` returns a session immediately.

Phone OTP requires a Twilio integration — configure in **Authentication → Providers → Phone**.

## Build phases

- **Phase 1 (current):** Full onboarding flow with Supabase auth
- **Phase 2:** Ask tab — RAG query surface with streaming answers

## Building for the App Stores

When ready for production (requires EAS cloud build from Windows):

```bash
npm install -g eas-cli
eas login
eas build --platform ios      # or android, or all
eas submit --platform ios
```

iOS bundle ID: `com.qwiva.app` · Android package: `com.qwiva.app`
