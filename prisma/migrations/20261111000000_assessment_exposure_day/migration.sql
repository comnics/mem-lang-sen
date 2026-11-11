-- Bound the assessment deferral lookup to one user's local-day range.
CREATE INDEX "ExposureEvent_userId_createdAt_idx" ON "app"."ExposureEvent"("userId", "createdAt");
