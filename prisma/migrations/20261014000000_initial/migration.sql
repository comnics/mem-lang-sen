-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "app"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "app"."ContentLevel" AS ENUM ('A1', 'A2', 'B1');

-- CreateEnum
CREATE TYPE "app"."SetCategory" AS ENUM ('SITUATION', 'PATTERN', 'FUNCTION');

-- CreateEnum
CREATE TYPE "app"."ContentStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "app"."StudyMode" AS ENUM ('WRITTEN', 'SPOKEN');

-- CreateEnum
CREATE TYPE "app"."SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "app"."ExposureKind" AS ENUM ('HINT', 'ANSWER');

-- CreateEnum
CREATE TYPE "app"."ReviewResult" AS ENUM ('CORRECT', 'INCORRECT', 'ASSISTED', 'SELF_REPORTED');

-- CreateEnum
CREATE TYPE "app"."SelfRating" AS ENUM ('AGAIN', 'GOOD');

-- CreateEnum
CREATE TYPE "app"."AudioStatus" AS ENUM ('PENDING', 'READY');

-- CreateTable
CREATE TABLE "app"."AppUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "app"."UserRole" NOT NULL DEFAULT 'USER',
    "status" "app"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."StudyPlan" (
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "dailyMinutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "app"."AudioAsset" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "app"."AudioStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Sentence" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sentence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."SentenceVersion" (
    "id" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "acceptedAnswers" TEXT[],
    "hint" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "level" "app"."ContentLevel" NOT NULL,
    "status" "app"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "audioAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentenceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."StudySet" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "app"."SetCategory" NOT NULL,
    "level" "app"."ContentLevel" NOT NULL,
    "status" "app"."ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "StudySet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."SetSentence" (
    "setId" TEXT NOT NULL,
    "sentenceVersionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "SetSentence_pkey" PRIMARY KEY ("setId","sentenceVersionId")
);

-- CreateTable
CREATE TABLE "app"."Enrollment" (
    "userId" UUID NOT NULL,
    "setId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("userId","setId")
);

-- CreateTable
CREATE TABLE "app"."StudySession" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "setId" TEXT NOT NULL,
    "mode" "app"."StudyMode" NOT NULL,
    "status" "app"."SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."SessionItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sentenceVersionId" TEXT NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ReviewEvent" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "sessionItemId" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "answer" TEXT,
    "selfRating" "app"."SelfRating",
    "result" "app"."ReviewResult" NOT NULL,
    "correct" BOOLEAN,
    "targetSnapshot" TEXT NOT NULL,
    "acceptedAnswers" TEXT[],
    "explanation" TEXT NOT NULL,
    "assisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ExposureEvent" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "sessionItemId" TEXT NOT NULL,
    "kind" "app"."ExposureKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExposureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."UserSentenceState" (
    "userId" UUID NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "mode" "app"."StudyMode" NOT NULL,
    "lastResult" "app"."ReviewResult" NOT NULL,
    "lastPracticedAt" TIMESTAMP(3) NOT NULL,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "assistedCount" INTEGER NOT NULL DEFAULT 0,
    "selfReportedGood" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserSentenceState_pkey" PRIMARY KEY ("userId","sentenceId","mode")
);

-- CreateTable
CREATE TABLE "app"."UserSentencePreference" (
    "userId" UUID NOT NULL,
    "sentenceId" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSentencePreference_pkey" PRIMARY KEY ("userId","sentenceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_email_key" ON "app"."AppUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AudioAsset_path_key" ON "app"."AudioAsset"("path");

-- CreateIndex
CREATE INDEX "SentenceVersion_status_level_idx" ON "app"."SentenceVersion"("status", "level");

-- CreateIndex
CREATE UNIQUE INDEX "SentenceVersion_sentenceId_versionNumber_key" ON "app"."SentenceVersion"("sentenceId", "versionNumber");

-- CreateIndex
CREATE INDEX "StudySet_status_category_level_idx" ON "app"."StudySet"("status", "category", "level");

-- CreateIndex
CREATE UNIQUE INDEX "SetSentence_setId_order_key" ON "app"."SetSentence"("setId", "order");

-- CreateIndex
CREATE INDEX "StudySession_userId_createdAt_idx" ON "app"."StudySession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionItem_sessionId_idx" ON "app"."SessionItem"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionItem_sessionId_position_key" ON "app"."SessionItem"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_sessionItemId_key" ON "app"."ReviewEvent"("sessionItemId");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_createdAt_idx" ON "app"."ReviewEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_userId_eventId_key" ON "app"."ReviewEvent"("userId", "eventId");

-- CreateIndex
CREATE INDEX "ExposureEvent_userId_sessionItemId_kind_idx" ON "app"."ExposureEvent"("userId", "sessionItemId", "kind");

-- AddForeignKey
ALTER TABLE "app"."StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SentenceVersion" ADD CONSTRAINT "SentenceVersion_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "app"."Sentence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SentenceVersion" ADD CONSTRAINT "SentenceVersion_audioAssetId_fkey" FOREIGN KEY ("audioAssetId") REFERENCES "app"."AudioAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SetSentence" ADD CONSTRAINT "SetSentence_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app"."StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SetSentence" ADD CONSTRAINT "SetSentence_sentenceVersionId_fkey" FOREIGN KEY ("sentenceVersionId") REFERENCES "app"."SentenceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Enrollment" ADD CONSTRAINT "Enrollment_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app"."StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."StudySession" ADD CONSTRAINT "StudySession_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app"."StudySet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SessionItem" ADD CONSTRAINT "SessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "app"."StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SessionItem" ADD CONSTRAINT "SessionItem_sentenceVersionId_fkey" FOREIGN KEY ("sentenceVersionId") REFERENCES "app"."SentenceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "app"."SessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ExposureEvent" ADD CONSTRAINT "ExposureEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ExposureEvent" ADD CONSTRAINT "ExposureEvent_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "app"."SessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UserSentenceState" ADD CONSTRAINT "UserSentenceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UserSentenceState" ADD CONSTRAINT "UserSentenceState_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "app"."Sentence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UserSentencePreference" ADD CONSTRAINT "UserSentencePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."UserSentencePreference" ADD CONSTRAINT "UserSentencePreference_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "app"."Sentence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

