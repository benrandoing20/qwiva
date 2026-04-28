# ROADMAP.md — Qwiva Mobile App

Version: v1 (KCS/KMA July 2026 launch)
Last updated: 2026-04-27
Status: Focused v1 scope — single-feature dual-platform launch

---

## 1. North Star

Qwiva launches a polished, focused mobile app at the **KCS/KMA conferences in July 2026**, available on **both the iOS App Store and Google Play Store**. The launch product is a single, excellent feature: **Ask** — clinical Q&A backed by Qwiva's existing RAG infrastructure, with full background query handling.

Push notifications are platform-asymmetric at v1: iOS gets full push at launch; Android gets foreground-only notification handling at launch with full push following in v1.1 (2-4 weeks post-conference). This is a deliberate trade to keep the launch on time without compromising platform reach. Background query resilience works on both platforms — queries persist server-side and resume cleanly on app return.

This is a deliberate "narrow but excellent" launch. We'd rather ship one feature that delights clinicians than five features that disappoint them. Other Qwiva products (surveys, CPD, gamification) ship in v1.1+ as the platform matures.

The premium quality bar is non-negotiable. Visual polish, animation, microcopy, edge-case handling, and the operational reliability of notifications and background queries are not "nice to haves." They are the product. A clinician's first three minutes with the app determine whether they recommend it to colleagues.

Two audiences are evaluating the app at launch:

- **Clinicians** at the conference booth, expected to download and ask their first real clinical question within minutes. Most are on Android (Kenya's dominant platform); iOS minority is strategically important but smaller in absolute numbers.
- **Pharma partners**, evaluating Qwiva as a future commercial channel. The pitch: "Qwiva has built the clinical Q&A product for East African clinicians, with engaged users on both iOS and Android, and infrastructure ready for surveys in Q4."

A successful launch means: clinicians download on either platform, ask, return, recommend. Pharma partners see a polished foundation across both Kenyan platform majorities, and conversations open about v1.1 surveys.

---

## 2. Development model and build pipeline

This section makes the development-to-shipping path explicit.

### Three modes of running the app

**Expo Go** — Expo's pre-built app. Currently used for development. Limited to native modules already bundled in Expo Go's runtime. **Not a deployment path**; users cannot install Qwiva via Expo Go.

**Development build** — A custom dev client compiled with Qwiva's specific native dependencies. Preserves the developer experience (hot reload, JS bundle loading, debug menu). Used during Sprints 1-5 for active development. Built via EAS Build.

**Production build** — A signed, store-ready binary. The `.ipa` (iOS) and `.aab` (Android) uploaded to App Store Connect and Google Play Console. This is what end users download. Built via EAS Build with the production profile.

### EAS — Expo Application Services

EAS is Expo's cloud platform that handles native builds, submissions, and over-the-air updates. Three relevant products:

- **EAS Build** — Cloud builds for iOS (no Mac required) and Android. Free tier covers ~30 builds/month, sufficient for v1 development. Used throughout the roadmap.
- **EAS Submit** — Optional cloud submission to both stores. Convenient but not required.
- **EAS Update** — Over-the-air JS bundle updates post-launch. Configured by Sprint 5 for fast post-launch bug fixes without store review.

### When the dev build replaces Expo Go

The transition happens in **Sprint 1**, triggered by Apple sign-in implementation (`expo-apple-authentication` is not in Expo Go's runtime). From Sprint 1 onward, all development happens in dev builds, not Expo Go.

### Practical setup notes

- Apple Developer account ($99/year): paid Sprint 1, before EAS iOS builds can be signed.
- Google Play Console ($25 one-time): paid Sprint 1, before EAS Android builds can be uploaded.
- iOS dev builds are tied to specific device UDIDs and expire every 7 days; weekly rebuilds during dev are normal and take ~10 minutes.
- Android dev builds are sideloaded as APKs and can be installed on any device.
- TestFlight (iOS) and Internal Testing track (Google Play) are how beta builds are distributed in Sprint 5; these use a separate `preview` build profile.

---

## 3. What ships at v1 (July 2026)

### Onboarding (both platforms)
- Email sign-up + Google sign-in (already shipped).
- **Apple sign-in** — required for iOS App Store compliance. Hidden on Android.
- Phone collection as soft-gate (already shipped, OTP paused).
- Cadre, registration number, specialty/rotation flow (already shipped).
- **Phase 1 polish complete:** password visibility toggle, "Forgot password" link, fixed `_layout.tsx` SIGNED_IN auth listener.

### Ask tab — the launch feature (both platforms)
- Connected to Qwiva's existing RAG backend.
- **Streaming responses** with inline citation chips.
- Citation chips link to source documents (PDF or web view).
- **Durable queries:** queries identified by ID, persist server-side, resumable if app backgrounds mid-stream. Works identically on both platforms.
- **Multi-turn within a session:** clinician can ask follow-up questions in the same conversation.
- Full visual polish: animations, loading states, empty states, error states.
- Clean, designed first-run experience.

### Push notifications — platform asymmetry at v1
**iOS (full push at v1):**
- Custom APNs integration via Supabase Edge Functions.
- "Your answer is ready" notification when a query completes while app is backgrounded or closed.
- Tap deep-links directly to the answer.

**Android (foreground-only at v1, full FCM in v1.1):**
- In-app notification banner when query completes while user is in the app.
- Backgrounded queries persist server-side and load on app return.
- No proactive push to backgrounded/closed app at v1.
- v1.1 ships full FCM push on Android (2-4 weeks post-launch).

### Pulse tab — waitlist (both platforms)
- Tab is reachable but shows a designed waitlist screen.
- Headline: *"Paid surveys for clinicians — coming Q4 2026."*
- Brief value proposition: clinicians earn for completing pharma-sponsored research.
- Push opt-in: *"Notify me when surveys launch."*
- Captures interest as a list (Supabase table); becomes the v1.1 launch list.
- Visually polished — feels like a real "coming soon" treatment, not a missing feature.

### Me tab (both platforms)
- Profile display (real Supabase data, already partially shipped).
- Sign out.
- "Surveys + Earnings — coming soon" pointer to the Pulse waitlist.
- Push notification preferences toggle (master on/off).

### Feed and Learn tabs
- Stay as mock data with a "Coming soon" treatment.
- Tabs accessible but immediately surface "We're working on this" messaging.
- No engineering investment beyond making the existing mock screens not look broken.

### Notification infrastructure
- Custom notification dispatch built on Supabase Edge Functions.
- Direct integration with APNs (iOS, full v1).
- FCM scaffolding present but not active for Android push at v1; activated in v1.1.
- Device token registration on sign-in (both platforms — Android tokens stored but not yet used for push at v1).
- Notification audit log (debugging).
- Architecture supports adding more notification types later (survey alerts, payout confirmations) without rework.

### Operational
- Privacy policy aligned to Kenya Data Protection Act 2019.
- Terms of service.
- iOS App Store assets: 5-10 polished screenshots, app icon, marketing description.
- Google Play Store assets: 5-10 polished screenshots (different aspect ratios), feature graphic, app icon, marketing description.
- iOS App Store submission and review.
- Google Play Store submission and review.

---

## 4. What's deferred to v1.1 (October-November 2026)

These are deferred, not cut. They have a real home in v1.1.

- **Android push notifications via FCM** (matches iOS for full platform parity).
- **Pulse — full surveys product** (delivery, completion, anti-fraud, ledger).
- **Manual M-Pesa payouts** (weekly batched, KES 200 minimum, ops dashboard).
- **Gamification tiers** (Healer / Clinician / Oracle).
- **Survey notifications** (new survey available, survey closing soon).
- **Payout notifications** (your weekly payout has been sent).

---

## 5. What's deferred to v1.5 (December 2026 - January 2027)

- **Automated M-Pesa B2C disbursement** via Daraja API. Likely outsourced to a Nairobi contractor when budget allows.
- **Referral system** with attribution and M-Pesa payouts.
- **Real XP / streaks gamification** beyond tier badges.
- **Cross-session conversation history** in Ask.
- **Saved/bookmarked answers.**

---

## 6. What's out of scope entirely (v2 or later)

- **Feed tab activation** with real evidence content.
- **Learn tab activation** with CPD modules + KMPDC integration.
- **Web app feature parity** — web RAG product continues independently.
- **Multi-language support.**
- **Phone OTP verification** (paused pending SMS provider).
- **Pharma partner self-service dashboard.**

---

## 7. Constraints and assumptions

### Calendar
- App Store + Play Store submissions: **June 1, 2026** (allows two review cycles before mid-June drop-dead).
- Feature-complete: **May 24, 2026.**
- Beta testing window: **May 24 – June 1.**
- Conference launch: **July 2026** (specific dates TBD by KCS/KMA).

### Team
- **Brian (you):** ~25 hours/week. Mobile app (both platforms), design, App Store + Play Store ops, custom notification mobile-side.
- **Ben:** ~15 hours/week assumed. Backend (RAG mobile integration, durable queries, custom notification dispatch).
- No additional contractors in v1 budget.

### Money flows
- $99/year Apple Developer account: must be paid week 1.
- $25 one-time Google Play Console fee: must be paid week 1.
- Non-Huawei Android test device: must be in hand by end of Sprint 1.
- No other v1 expenses budgeted.

### Hardware for testing
- iPhone (Brian's): primary iOS testing.
- Non-Huawei Android device (Samsung mid-range, Tecno, or Pixel): in hand by end of Sprint 1. Hard prerequisite for Android quality. Huawei devices alone cannot test FCM-bound flows due to lack of Google Play Services.

### Technical
- Expo SDK 54 lock continues. All dependencies must be SDK 54-compatible.
- Development model graduates from Expo Go to EAS development builds in Sprint 1 (Apple sign-in trigger).
- Custom notification infrastructure built on Supabase Edge Functions + APNs at v1 (FCM in v1.1).
- Architectural commitment in Sprint 2: durable RAG queries (queries identified by ID, server-side resumable). Foundation for both background resilience and notification delivery on both platforms.
- EAS Build configuration for both platforms.

---

## 8. Sprint plan

Six sprints, each one week (Monday-Sunday). Each sprint ends with a demoable state on both platforms. If a sprint slips by more than 2 days, the *what-do-we-cut* line tells us what comes off.

### Sprint 1 — April 28 to May 4 — Foundations + dual-platform setup

**Brian:**
- Pay for Apple Developer account.
- Pay for Google Play Console developer account.
- Procure non-Huawei Android test device (must be in hand by end of week).
- EAS account setup; `eas init` from project root.
- Apple sign-in implementation (mirrors Google sign-in pattern from this past week). Triggers first dev build.
- First EAS development build for iOS (~25 min in cloud).
- First EAS development build for Android (after Android device arrives).
- Password visibility toggle on register.tsx.
- "Forgot password" link wired on login.tsx.
- ~~Fix `_layout.tsx` SIGNED_IN auth listener.~~ Verified not needed — every sign-in flow navigates explicitly via `getPostAuthRoute`. CLAUDE.md updated to reflect.
- `expo-notifications` install + permission UX scaffolding (no notifications fired yet).
- **Verify password reset deep link end-to-end on EAS development build.** Code is shipped but the deep link tap-to-open behavior cannot be tested in Expo Go due to custom URL scheme limitations. Once dev build is installed, tap the email reset link → confirm app opens → reset screen renders with a valid recovery session → password update succeeds → user is auto-routed via getPostAuthRoute.
- Run existing onboarding flow on Android dev build, fix any platform-specific issues (haptics, layout, fonts).

**Ask tab — design-faithful UI shipped early (April 27):**
- Empty state with cadre-aware Lora greeting and frosted suggestions card.
- Sidebar drawer (two-layer: fixed sidebar + draggable panel) with chat history scaffolding, KMPDB-style cream surface, restored shadow, "qwiva" wordmark in Gilroy SemiBold.
- Response mode selector pill in top bar replacing static "Ask" title. Frosted-glass dropdown with 4 modes (Default / Ward round / Study / Consult) plus Adaptive thinking toggle.
- Bottom sheet for attachments (Camera / Photos / Files) and advanced options (Add to project / Tool access / Connectors). Reusable `SheetContainer` primitive with two snap states, gate-based dismissal, smooth spring physics.
- All visual chrome lands ahead of Sprint 2 backend integration. Sprint 2 work becomes "wire RAG into existing UI" instead of "build UI alongside backend."

**Ben:**
- Architecture decision: durable RAG query system.
  - Queries get IDs, persist server-side as rows in a `rag_queries` table.
  - Stream tokens are written to the same row as they arrive.
  - Status flows: `queued` → `running` → `complete` (or `error`).
- Begin scoping the mobile RAG endpoint (request/response shape, streaming protocol).

**Demoable state:** Onboarding flow polished on both platforms (in dev builds). Three sign-in methods working on iOS. Two sign-in methods working on Android (Apple sign-in hidden). Notification permission flow asks correctly. Backend has durable query foundation.

**What we cut if this slips:** Apple sign-in moves to Sprint 2 (delays iOS App Store submission only). Android device procurement is non-negotiable; cannot slip.

### Sprint 2 — May 5 to May 11 — RAG mobile integration (both platforms)

**Brian:**
- Wire submit-query handler in Ask tab to Ben's RAG endpoint via durable query ID flow:
  - Submit query → receive query ID.
  - Subscribe to streaming endpoint by ID.
  - Render tokens as they arrive in a new active-conversation surface (built on top of existing empty state).
- Build the active-conversation view: query bubble at top, streaming response below, citation chips inline.
- Loading and error states (existing UI surfaces extended for active state).
- Wire response mode selector to actually change RAG behavior (mode included in query payload).
- Test on both iOS and Android dev builds. Streaming behavior parity check.

**Ben:**
- RAG endpoint exposed in mobile-friendly shape:
  - POST `/queries` returns query ID.
  - Subscribe (SSE or WebSocket) to `/queries/:id/stream` for tokens.
  - GET `/queries/:id` for full state (used for resume).
- Authentication via Supabase JWT.
- Test data: 10 sample clinical questions with expected answers (regression suite).

**Demoable state:** Ask tab works end-to-end on both platforms. You can ask a real clinical question and get a streaming cited answer on iOS or Android. Foreground-only at this point.

**What we cut if this slips:** Streaming becomes single-shot response. Citations become numbered references at bottom rather than inline chips. Both are upgradeable in v1.1.

### Sprint 3 — May 12 to May 18 — iOS push notifications + background resilience (both platforms)

**Brian:**
- iOS push notification client setup:
  - APNs device token registration on sign-in.
  - Token storage in Supabase.
  - Foreground notification handler (in-app banner).
  - Background notification handler (system notification).
  - Tap-to-deep-link: notification → Ask tab → specific answer.
- Background query resume (both platforms): app comes to foreground with in-flight query, fetch latest state by ID, resume rendering.
- Android in-app banner for foreground-only notifications (same UX as iOS foreground case).
- Android FCM token registration scaffolding (token captured but not yet dispatched at v1; ready for v1.1).
- Likely needs a fresh dev build mid-sprint as native notification config evolves.

**Ben:**
- Supabase Edge Function for sending push notifications (APNs):
  - APNs integration (certificate, request signing).
  - Function called when query state transitions to `complete` for iOS users.
  - Notification payload includes query ID for deep linking.
- Background query runner:
  - Query keeps running server-side even if mobile client disconnects.
  - On completion, dispatches notification to iOS users; logs intent for Android users (will be activated in v1.1).
- Notification audit log table.

**Demoable state:** Submit a query on iOS dev build, background the app, get a push notification when complete, tap to land on the answer. On Android dev build, submit a query, background, return to the app, see the answer loaded. Both platforms have working background resilience.

**What we cut if this slips:** iOS push moves to v1.1, both platforms ship with foreground-only at v1. Real product hit on iOS but launch-recoverable.

### Sprint 4 — May 19 to May 25 — Polish (both platforms)

**Brian:**
- Visual polish across Ask tab on both platforms:
  - Animations on query submit, response render, citation hover/tap.
  - Edge case states (no network, slow network, server error, ambiguous query).
  - Microcopy review across the entire flow.
  - Empty state illustration (or designed icon-only treatment).
- Pulse and Me tab waitlist screens designed and built (both platforms).
- Feed and Learn tab "coming soon" treatments.
- App icons refined for iOS and Android (Android adaptive icon required).
- iOS App Store screenshots (5-10).
- Google Play Store screenshots (5-10, different aspect ratios).
- Privacy policy text drafted.
- Terms of service text drafted.

**Ben:**
- Seed the RAG with content quality checks for 10 high-priority clinical topic areas.
- Notification dispatch reliability hardening (retry on APNs errors, token refresh).
- Backend monitoring basics (alert if query queue depth exceeds threshold, alert if notification dispatch fails).

**Demoable state:** App is feature-complete and visually polished on both platforms. All tabs feel deliberate (real feature OR designed waitlist). Internal QA passes.

**What we cut if this slips:** Privacy policy/Terms become "minimum legally adequate" template-based. Pulse/Me waitlist screens become functional but not polished. Android polish gets compressed before iOS polish.

### Sprint 5 — May 26 to June 1 — Beta + dual store submission

**Brian:**
- Configure EAS preview build profile (TestFlight + Google Play Internal Testing distribution).
- Production EAS builds for iOS and Android.
- Internal beta with 5-10 clinicians from Qwiva network. Distributed via TestFlight (iOS) and Internal Testing track (Google Play).
- Bug fixes from beta feedback.
- iOS App Store submission (no later than **June 1**).
- Google Play Store submission (no later than **June 1**).
- Marketing site updates / landing page (mention both platforms).
- Configure EAS Update for post-launch JS bundle hotfixes.

**Ben:**
- Operational sanity testing of notification system at small scale.
- Backend monitoring dashboards (you can see queries/min, notification success rate, errors).
- Documentation for ops procedures.

**Demoable state:** App is in review on both stores. Operational systems verified. EAS Update configured for post-launch bug fixes.

**What we cut if this slips:** External beta is skipped; you and Ben become the only beta testers. Submission slips later in week.

### Sprint 6 — June 2 to June 8 — Store reviews + final ops

**Brian:**
- Respond to App Store review feedback (expect at least 1 rejection cycle on iOS).
- Respond to Google Play review feedback (typically faster than iOS, 1-3 days).
- Resubmissions if needed.
- Conference materials: booth signage, QR codes for download (one per platform, or universal link), demo flow.
- Press / outreach prep.

**Ben:**
- Production notification system at full readiness.
- Survey content pipeline planning for v1.1 (who writes surveys, what schema, how delivered).

**Demoable state:** App is approved on both stores. Ready for launch.

**What we cut if this slips:** Conference materials get rushed or simplified. App itself is the priority.

### Sprints 7-9 — June 9 to June 30 — Buffer + soft launch

Calendar buffer for store delays, additional rejection cycles, real-world testing.

- Soft-launch to Qwiva's existing network and Pulse waitlist signups (both platforms).
- Surface and fix any bugs before high-visibility conference. Use EAS Update for fast hotfixes.
- Prepare v1.1 backlog with realistic estimates (Android push is the priority).
- Begin v1.1 design work for Pulse.

### July — Conference week

- KCS conference (date TBD).
- KMA conference (date TBD).
- On-site support, watching for bugs on both platforms.
- QR code download flow tested on multiple device types.
- Collect feedback, sign-up data, pharma partner conversations.
- Pulse waitlist grows.
- v1.1 Android push priority confirmed based on real Android user feedback.

---

## 8a. Recent commits (most recent first)

Pre-Sprint work and Sprint 1 progress:

| Date | Commit | Summary |
|---|---|---|
| 2026-04-27 | `38bacf1` | Add bottom sheet for attachments and advanced options |
| 2026-04-27 | `f14cae9` | Add response mode selector to Ask tab top bar |
| 2026-04-27 | `7ff1cf7` | Add sidebar drawer to Ask tab matching Claude Design handoff |
| 2026-04-26 | `2071f94` | Build Ask tab empty state matching Claude Design handoff |
| 2026-04-26 | `1e8a032` | Document SIGNED_IN handling as intentionally per-screen |
| 2026-04-26 | `d0c4b0e` | Add password reset completion flow with deep link handling |
| 2026-04-26 | `87f036b` | Add Forgot password link and reset request screen |
| 2026-04-26 | `947caa2` | Add password visibility toggle to Input component |

All Ask tab visual surfaces are now in main. Backend integration starts Sprint 2.

---

## 9. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| App Store (iOS) rejects on first submission | High | Submit by June 1 to allow 2 cycles. Single-feature app reduces review surface area. |
| Google Play rejects on first submission | Medium | Generally less strict than Apple, but data safety and privacy declarations need to be exact. |
| EAS Build queue delays during peak times | Low | Free tier sometimes has 30-60 min queues. Build during off-hours when possible; upgrade to paid tier ($99/mo) if it becomes a blocker. |
| APNs certificate setup unexpectedly hard | Medium | Apple Developer account paid Sprint 1 immediately. Cert generation is sometimes fiddly; budget half-day in Sprint 3. |
| Android device-specific behavior bugs | Medium-High | Test on the procured non-Huawei device throughout. Budget bug-fix time at end of each sprint. |
| Huawei users cannot receive any push (even when v1.1 ships) | Low impact, accepted | Foreground notifications work on Huawei. Document the limitation. |
| RAG mobile integration surfaces issues | Medium | Sprint 2 is dedicated to this. Mobile networks slow/flaky vs web; durable queries means dropped connections aren't fatal. |
| iOS push notification edge cases | Medium | Sprint 3 dedicated to building and testing the notification flow. Expect 1-2 frustrating debugging sessions. |
| Custom notification infrastructure slows Sprint 3 | Medium | Fallback: foreground-only on iOS too at v1, push moves to v1.1 for both platforms. Real product cost but launch-recoverable. |
| Ben hours fall below 15h/week | Medium | Cuts come from Sprint 4 polish first, then iOS push falls back to foreground-only. |
| Brian hours fall below 25h/week | Low | Cuts come from Pulse/Me waitlist polish, then Android polish, then iOS polish. App Store + Play Store submissions stay sacred. |
| First-time clinical app review extra scrutiny (both stores) | Medium | Privacy policy aligned to Kenya DPA 2019. Avoid claiming any clinical decision-making (frame as "evidence retrieval"). |
| Pulse waitlist gets criticism for being incomplete | Low | Frame proactively: "We chose to ship one excellent feature first. Surveys arrive Q4." Confidence reads as discipline, not shortfall. |
| Android FCM gap noticed at conference | Low-Medium | Communicate clearly: "Android push notifications coming August 2026." Accept the temporary gap; ship the architecture so v1.1 is a small lift. |

---

## 10. Decisions still pending

- **Privacy policy author** — write yourself, use a template, or get legal review? Sprint 4.
- **iOS App Store category and keywords** — Sprint 4.
- **Google Play Store category and keywords** — Sprint 4.
- **Notification deep link format** — Sprint 3 implementation detail; doesn't block earlier sprints.
- **Specific App Store and Play Store screenshot designs** — Sprint 4-5.
- **Conference booth budget and materials** — Sprint 5-6.
- **v1.1 contractor budget** — when does the M-Pesa contractor get hired? Probably post-launch, funded from launch revenue or follow-on commercial conversations.
- **Specific Android test device model** — by end of Sprint 1. Recommend Samsung A24/A34 or Tecno Camon.
- **EAS paid tier upgrade trigger** — defer until queue delays become blocking.

---

## 11. Done criteria for v1 launch

The app is launch-ready when *all* of the following are true:

- [ ] App is live on iOS App Store, downloadable in Kenya.
- [ ] App is live on Google Play Store, downloadable in Kenya.
- [ ] A new clinician can sign up via Google or email on Android, or via Google/Apple/email on iOS, and complete the onboarding flow without any error states.
- [ ] Ask tab returns a real cited answer to a clinical question within 10 seconds (streaming start within 2 seconds) on both platforms.
- [ ] Long queries (>15 seconds) survive app backgrounding without losing state on both platforms.
- [ ] iOS push notification fires reliably when a query completes while app is backgrounded.
- [ ] Android shows in-app banner when query completes while app is foregrounded; query state is loaded on app return.
- [ ] Tapping an iOS push notification deep-links to the specific answer.
- [ ] Apple sign-in functional on iOS.
- [ ] Pulse and Me tabs show polished waitlist treatments on both platforms.
- [ ] Privacy policy and Terms accessible from Me tab on both platforms.
- [ ] Internal beta has run with 5+ clinicians across both platforms; bugs surfaced have been fixed.
- [ ] Conference QR code download flow tested on iPhone, the procured Android test device, plus at least one borrowed Android (Samsung or Tecno preferred).
- [ ] EAS Update configured for post-launch JS bundle hotfixes.

---

## 12. v1.1 backlog (Q4 2026)

- **Android push notifications via FCM** (the priority — closes the platform parity gap).
- Pulse tab — full surveys product (delivery, completion, anti-fraud).
- Manual M-Pesa payouts (weekly batched, ops dashboard).
- Gamification tiers (Healer / Clinician / Oracle).
- Survey notifications.
- Payout notifications.
- Cross-session conversation history in Ask.
- Saved/bookmarked answers.
- Phone OTP verification (when SMS provider sorted).

## 13. v1.5 backlog (Q1 2027)

- Automated M-Pesa B2C disbursement.
- Referral system with attribution and payouts.
- Real XP / streaks gamification.
- Pharma partner self-service dashboard.

## 14. v2 backlog (TBD)

- Feed tab activation with real evidence content.
- Learn tab activation with CPD modules + KMPDC integration.
- Multi-language support.
- Web/mobile feature parity audit.

---

## 15. How this document is used

This roadmap is a living document. It commits to git and gets updated as facts change.

**Update triggers:**
- Sprint completion: mark deliverables done, note what cut/slipped, update next sprint's plan.
- Decision resolved: mark in section 10, fold into the relevant sprint or scope section.
- New blocker discovered: add to risks (section 9) with a mitigation.
- Scope change requested: discuss explicitly, update either v1, v1.1, v1.5, or out-of-scope sections, commit the change.

**Update cadence:** end of each sprint, plus ad-hoc when something material shifts.

**Source of truth conflicts:** if this document and CLAUDE.md disagree, CLAUDE.md wins for technical conventions; this document wins for scope and timeline. Where they should agree (e.g. screen status), update both together.
