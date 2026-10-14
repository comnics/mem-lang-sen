-- AlterEnum
ALTER TYPE "app"."SessionStatus" ADD VALUE 'ABANDONED';

-- AlterTable
ALTER TABLE "app"."Enrollment" ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "app"."ReviewEvent" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "hard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextDueAt" TIMESTAMP(3),
ADD COLUMN     "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "qualified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewStep" INTEGER,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "studyDate" TEXT,
ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "app"."SessionItem" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "estimatedSeconds" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "app"."StudyPlan" ADD COLUMN     "anchorDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "intervalDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "localTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveryDate" TEXT,
ADD COLUMN     "ruleType" TEXT NOT NULL DEFAULT 'WEEKDAYS',
ADD COLUMN     "startDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "targetDate" TEXT;

-- AlterTable
ALTER TABLE "app"."StudySession" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'PRACTICE',
ADD COLUMN     "studyDate" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
ALTER COLUMN "setId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "app"."UserSentencePreference" ADD COLUMN     "lastExposedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "app"."UserSentenceState" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "lastQualifiedAt" TIMESTAMP(3),
ADD COLUMN     "policyVersion" TEXT NOT NULL DEFAULT 'relative-v1',
ADD COLUMN     "qualifiedRecallCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewStep" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "app"."ScheduleException" (
    "userId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("userId","date")
);

-- CreateIndex
CREATE INDEX "StudySession_userId_purpose_studyDate_status_idx" ON "app"."StudySession"("userId", "purpose", "studyDate", "status");

-- CreateIndex
CREATE INDEX "UserSentenceState_userId_mode_dueAt_idx" ON "app"."UserSentenceState"("userId", "mode", "dueAt");

-- AddForeignKey
ALTER TABLE "app"."ScheduleException" ADD CONSTRAINT "ScheduleException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."StudyPlan"("userId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve historical timestamps; old sessions have no trustworthy local-date snapshot.
UPDATE app."ReviewEvent" SET "performedAt" = "createdAt";
UPDATE app."StudyPlan" SET "startDate" = to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE "timezone", 'YYYY-MM-DD'), "anchorDate" = to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE "timezone", 'YYYY-MM-DD');
ALTER TABLE app."StudyPlan" ALTER COLUMN "startDate" DROP DEFAULT, ALTER COLUMN "anchorDate" DROP DEFAULT;
UPDATE app."UserSentenceState" SET "dueAt" = "lastPracticedAt" + interval '1 day';
-- Cross-mode and cross-set exposures are shared. Keep hidden preferences intact.
INSERT INTO app."UserSentencePreference" ("userId", "sentenceId", "lastExposedAt", "createdAt", "updatedAt")
SELECT "userId", "sentenceId", max(at), now(), now() FROM (
 SELECT r."userId", i."sentenceId", r."createdAt" AS at FROM app."ReviewEvent" r JOIN app."SessionItem" i ON i.id=r."sessionItemId"
 UNION ALL
 SELECT e."userId", i."sentenceId", e."createdAt" AS at FROM app."ExposureEvent" e JOIN app."SessionItem" i ON i.id=e."sessionItemId"
) exposures GROUP BY "userId", "sentenceId"
ON CONFLICT ("userId", "sentenceId") DO UPDATE SET "lastExposedAt"=EXCLUDED."lastExposedAt";
ALTER TABLE app."StudyPlan" ADD CONSTRAINT "StudyPlan_rule_check" CHECK ("ruleType" IN ('WEEKDAYS','INTERVAL') AND "intervalDays" BETWEEN 1 AND 30);
ALTER TABLE app."ScheduleException" ADD CONSTRAINT "ScheduleException_kind_check" CHECK (kind IN ('ADD','SKIP'));
ALTER TABLE app."UserSentenceState" ADD CONSTRAINT "UserSentenceState_step_check" CHECK ("reviewStep" BETWEEN 0 AND 4 AND "qualifiedRecallCount" >= 0);
ALTER TABLE app."StudySession" ADD CONSTRAINT "StudySession_purpose_check" CHECK (purpose IN ('PRACTICE','DAILY'));
-- Runtime DML grants are provisioned by local:setup/platform:setup after migrations.
