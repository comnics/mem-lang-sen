export const REVIEW_POLICY_VERSION = 'relative-v1' as const;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_STAGE = 0;
const MAX_STAGE = REVIEW_INTERVAL_DAYS.length - 1;

export type ReviewMode = 'WRITTEN' | 'SPOKEN';
export type ReviewResult = 'CORRECT' | 'INCORRECT' | 'ASSISTED' | 'SELF_REPORTED';
export type SelfRating = 'GOOD' | 'AGAIN';

export type PreviousReviewState = {
  reviewStep: number;
  dueAt: Date | null;
  qualifiedRecallCount: number;
  lastQualifiedAt: Date | null;
};

export type ComputeReviewInput = {
  now: Date;
  mode: ReviewMode;
  result: ReviewResult;
  selfRating?: SelfRating;
  hard?: boolean;
  previous: PreviousReviewState | null;
  lastExposureAt: Date | null;
};

export type ComputeReviewOutput = {
  reviewStep: number;
  dueAt: Date;
  qualified: boolean;
  qualifiedRecallCount: number;
  lastQualifiedAt: Date | null;
  reason: string;
};

export function computeReview(input: ComputeReviewInput): ComputeReviewOutput {
  const now = cloneDate(input.now);
  const previous = normalizePrevious(input.previous);

  if (input.mode === 'SPOKEN') return computeSpokenReview(input, previous, now);
  return computeWrittenReview(input, previous, now);
}

function computeWrittenReview(input: ComputeReviewInput, previous: PreviousReviewState | null, now: Date): ComputeReviewOutput {
  if (input.result !== 'CORRECT') {
    return resetReview(previous, now, 'written-relearn');
  }

  if (!previous) {
    return {
      reviewStep: MIN_STAGE,
      dueAt: addInterval(now, MIN_STAGE),
      qualified: false,
      qualifiedRecallCount: 0,
      lastQualifiedAt: null,
      reason: 'written-first-success',
    };
  }

  const dueAt = previous.dueAt;
  const dueReached = Boolean(dueAt && now.getTime() >= dueAt.getTime());
  const exposureReady = !input.lastExposureAt || now.getTime() - input.lastExposureAt.getTime() >= DAY_MS;

  if (!dueReached || !exposureReady) {
    return {
      reviewStep: previous.reviewStep,
      dueAt: dueAt && now.getTime() < dueAt.getTime() ? cloneDate(dueAt) : addInterval(now, MIN_STAGE),
      qualified: false,
      qualifiedRecallCount: previous.qualifiedRecallCount,
      lastQualifiedAt: cloneNullableDate(previous.lastQualifiedAt),
      reason: !dueReached ? 'written-early-success' : 'written-recent-exposure',
    };
  }

  const nextStep = input.hard ? previous.reviewStep : clampStage(previous.reviewStep + 1);
  return {
    reviewStep: nextStep,
    dueAt: addInterval(now, nextStep),
    qualified: true,
    qualifiedRecallCount: previous.qualifiedRecallCount + 1,
    lastQualifiedAt: now,
    reason: input.hard ? 'written-qualified-hard' : 'written-qualified',
  };
}

function computeSpokenReview(input: ComputeReviewInput, previous: PreviousReviewState | null, now: Date): ComputeReviewOutput {
  if (input.selfRating !== 'GOOD') {
    return resetReview(previous, now, 'spoken-again');
  }

  if (!previous) {
    return {
      reviewStep: MIN_STAGE,
      dueAt: addInterval(now, MIN_STAGE),
      qualified: false,
      qualifiedRecallCount: 0,
      lastQualifiedAt: null,
      reason: 'spoken-first-good',
    };
  }

  const dueReached = Boolean(previous.dueAt && now.getTime() >= previous.dueAt.getTime());
  if (!dueReached) {
    return {
      reviewStep: previous.reviewStep,
      dueAt: previous.dueAt && now.getTime() < previous.dueAt.getTime() ? cloneDate(previous.dueAt) : addInterval(now, MIN_STAGE),
      qualified: false,
      qualifiedRecallCount: previous.qualifiedRecallCount,
      lastQualifiedAt: cloneNullableDate(previous.lastQualifiedAt),
      reason: 'spoken-early-good',
    };
  }

  const nextStep = input.hard ? previous.reviewStep : clampStage(previous.reviewStep + 1);
  return {
    reviewStep: nextStep,
    dueAt: addInterval(now, nextStep),
    qualified: false,
    qualifiedRecallCount: previous.qualifiedRecallCount,
    lastQualifiedAt: cloneNullableDate(previous.lastQualifiedAt),
    reason: input.hard ? 'spoken-due-good-hard' : 'spoken-due-good',
  };
}

function resetReview(previous: PreviousReviewState | null, now: Date, reason: string): ComputeReviewOutput {
  return {
    reviewStep: MIN_STAGE,
    dueAt: addInterval(now, MIN_STAGE),
    qualified: false,
    qualifiedRecallCount: previous?.qualifiedRecallCount ?? 0,
    lastQualifiedAt: cloneNullableDate(previous?.lastQualifiedAt ?? null),
    reason,
  };
}

function normalizePrevious(previous: PreviousReviewState | null): PreviousReviewState | null {
  if (!previous) return null;
  return {
    reviewStep: clampStage(previous.reviewStep),
    dueAt: cloneNullableDate(previous.dueAt),
    qualifiedRecallCount: Math.max(0, Math.trunc(previous.qualifiedRecallCount)),
    lastQualifiedAt: cloneNullableDate(previous.lastQualifiedAt),
  };
}

function addInterval(date: Date, reviewStep: number): Date {
  return new Date(date.getTime() + REVIEW_INTERVAL_DAYS[clampStage(reviewStep)] * DAY_MS);
}

function clampStage(value: number): number {
  if (!Number.isFinite(value)) return MIN_STAGE;
  return Math.min(MAX_STAGE, Math.max(MIN_STAGE, Math.trunc(value)));
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function cloneNullableDate(date: Date | null): Date | null {
  return date ? cloneDate(date) : null;
}
