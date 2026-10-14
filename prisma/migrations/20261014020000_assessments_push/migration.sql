-- AlterTable
ALTER TABLE "app"."ReviewEvent" ADD COLUMN     "exposureGapHours" DOUBLE PRECISION,
ADD COLUMN     "form" TEXT NOT NULL DEFAULT 'RECALL';

-- AlterTable
ALTER TABLE "app"."SessionItem" ADD COLUMN     "applicationQuestionId" TEXT,
ADD COLUMN     "form" TEXT NOT NULL DEFAULT 'RECALL';

-- AlterTable
ALTER TABLE "app"."UserSentencePreference" ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "selfReportedMemorized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "app"."AssessmentCohort" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "baselineVersionId" TEXT,

    CONSTRAINT "AssessmentCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."AssessmentAssignment" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "sessionItemId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "result" TEXT,
    "inWindow" BOOLEAN,
    "exposureGapHours" DOUBLE PRECISION,
    "interveningReviews" INTEGER,

    CONSTRAINT "AssessmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ApplicationQuestion" (
    "id" TEXT NOT NULL,
    "sentenceVersionId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "acceptedAnswers" TEXT[],
    "explanation" TEXT NOT NULL,
    "status" "app"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ContentReport" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "sentenceVersionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."NotificationPreference" (
    "userId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" TEXT NOT NULL DEFAULT '22:00',
    "quietEnd" TEXT NOT NULL DEFAULT '08:00',

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "app"."NotificationDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."JobRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."JobCursor" (
    "name" TEXT NOT NULL,
    "lastUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCursor_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCohort_userId_sentenceId_key" ON "app"."AssessmentCohort"("userId", "sentenceId");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_opensAt_answeredAt_idx" ON "app"."AssessmentAssignment"("opensAt", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAssignment_cohortId_kind_periodKey_key" ON "app"."AssessmentAssignment"("cohortId", "kind", "periodKey");

-- CreateIndex
CREATE INDEX "ContentReport_status_createdAt_idx" ON "app"."ContentReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "app"."PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_enabled_idx" ON "app"."PushSubscription"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_deliveryKey_key" ON "app"."NotificationDelivery"("deliveryKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "app"."NotificationDelivery"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "app"."SessionItem" ADD CONSTRAINT "SessionItem_applicationQuestionId_fkey" FOREIGN KEY ("applicationQuestionId") REFERENCES "app"."ApplicationQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AssessmentCohort" ADD CONSTRAINT "AssessmentCohort_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AssessmentCohort" ADD CONSTRAINT "AssessmentCohort_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "app"."Sentence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "app"."AssessmentCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "app"."SessionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ApplicationQuestion" ADD CONSTRAINT "ApplicationQuestion_sentenceVersionId_fkey" FOREIGN KEY ("sentenceVersionId") REFERENCES "app"."SentenceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentReport" ADD CONSTRAINT "ContentReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentReport" ADD CONSTRAINT "ContentReport_sentenceVersionId_fkey" FOREIGN KEY ("sentenceVersionId") REFERENCES "app"."SentenceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "app"."PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE app."StudySession" DROP CONSTRAINT "StudySession_purpose_check";
ALTER TABLE app."StudySession" ADD CONSTRAINT "StudySession_purpose_check" CHECK (purpose IN ('PRACTICE','DAILY','ASSESSMENT'));
ALTER TABLE app."SessionItem" ADD CONSTRAINT "SessionItem_form_check" CHECK (form IN ('RECALL','APPLICATION') AND ((form='APPLICATION')=("applicationQuestionId" IS NOT NULL)));
ALTER TABLE app."ReviewEvent" ADD CONSTRAINT "ReviewEvent_form_check" CHECK (form IN ('RECALL','APPLICATION') AND (form<>'APPLICATION' OR NOT qualified));
ALTER TABLE app."AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_kind_check" CHECK (kind IN ('RETENTION_7','RETENTION_30','WEEKLY') AND "opensAt" <= "dueAt" AND "dueAt" <= "closesAt");
ALTER TABLE app."ContentReport" ADD CONSTRAINT "ContentReport_status_check" CHECK (status IN ('OPEN','RESOLVED','DISMISSED'));
ALTER TABLE app."NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_status_check" CHECK (status IN ('PENDING','SENDING','SENT','FAILED','CANCELLED') AND attempts >= 0);
