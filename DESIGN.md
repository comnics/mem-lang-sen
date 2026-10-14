# Design

## Source of truth
- Status: Active. Refreshed: 2026-10-14.
- Surfaces: learner mobile web and separate admin workspace.
- Evidence: .omx/plans/mobile-conversation-memory-product-plan-2026-10-14.md and implementation plan. No existing UI or brand assets.

## Brand
- Working name: 문장정원 / Sentence Garden. Warm, focused, editorial learning notebook.
- Trust: show real counts and distinguish self-reported speaking from checked written recall.
- Avoid: fake progress, game currency, excessive gradients, implementation jargon in learner screens.

## Product goals
- Recall essential sentences without answer cues. M0–M6: enroll, recall, compare, record, schedule, assess and revisit.
- Non-goals: AI speech scoring, complete offline sentence packs, guaranteed memorization claims.
- Success: clear first-session completion, accurate history, no answer leakage.

## Personas and jobs
- Korean adult learning everyday English in 3–10 minute mobile sessions.
- Editor curating reusable, reviewed sentence sets.

## Information architecture
- Learner: 오늘, 세트, 내 문장, 기록, 달력. Assessments reachable from today/history; installation and reminders in settings.
- Admin: overview, sets, sentences, CSV import, application questions, reports and quality; separate sidebar/layout.
- Primary screen hierarchy: purpose/next action, meaningful content, optional details.

## Design principles
- One clear next action per study card. Reveal only after an attempt.
- Generous spacing, short Korean copy, calm feedback. Never label self-rating as verified mastery.
- Empty/setup/errors must be honest and actionable. No fake logged-in dashboard.

## Visual language
- Cream #f6f5f0 background, ink #203c32, green #245d45 primary, muted sage #dce8dd, terracotta #bc6143 accent.
- System Korean sans-serif stack, editorial serif on large English phrases; no network font dependency.
- 8px spacing rhythm, 20–28px cards, thin borders, subtle shadow.
- Motion minimal and reduced-motion aware. Lucide line icons, simple CSS botanical/typographic motif; no image assets needed.

## Components
- UI owner defines global CSS tokens, .button/.button-secondary/.card/.field/.badge/.page-heading/.empty-state/.notice classes in globals.css.
- Reuse semantic links/buttons; loading, error, success variants.
- Admin uses the same tokens with denser layouts; no changes to shared CSS without coordination.

## Accessibility
- WCAG AA intent, visible focus, real labels, 44px targets, no color-only feedback.
- Headings, nav labels, live result regions; support keyboard and reduced motion.

## Responsive behavior
- 360px minimum; learner desktop max width and bottom mobile nav; admin sidebar becomes top/stacked nav.
- Forms single column on mobile; tables scroll inside their own container.

## Interaction states
- Loading: button pending and skeleton/neutral text.
- Empty: say what is missing with a useful action.
- Error: preserve entered answer; show retry. Success: factual result.
- Offline: same-tab sessionStorage retains up to 20 immutable submissions for 24 hours; retry on reload/online/manual action. Server confirmation is required. Public offline shell only; no private page, API, RSC or audio cache.

## Content voice
- Korean friendly respectful endings. ‘입력 회상’, ‘말하기 자기확인’, ‘오늘 학습’.
- Never ‘완벽하게 암기’ or ‘기억력 100%’. Distinguish practice and assessment.

## Implementation constraints
- Next.js App Router, Tailwind v4, CSS tokens. Server-only auth/data.
- Screenshots at 390px and desktop; test 360px overflow and focus.

## Open questions
- Brand name is a reversible working assumption, pending later naming choice.
