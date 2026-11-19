ALTER TABLE app."Sentence" ADD COLUMN scope app."ContentScope" NOT NULL DEFAULT 'PUBLIC', ADD COLUMN "ownerId" uuid REFERENCES app."AppUser"(id) ON DELETE RESTRICT, ADD COLUMN "archivedAt" timestamp(3);
ALTER TABLE app."StudySet" ADD COLUMN scope app."ContentScope" NOT NULL DEFAULT 'PUBLIC', ADD COLUMN "ownerId" uuid REFERENCES app."AppUser"(id) ON DELETE RESTRICT, ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE app."Sentence" ADD CONSTRAINT sentence_scope_owner CHECK ((scope='PUBLIC' AND "ownerId" IS NULL) OR (scope='PERSONAL' AND "ownerId" IS NOT NULL));
ALTER TABLE app."StudySet" ADD CONSTRAINT set_scope_owner CHECK ((scope='PUBLIC' AND "ownerId" IS NULL AND status <> 'ACTIVE') OR (scope='PERSONAL' AND "ownerId" IS NOT NULL AND status IN ('DRAFT','ACTIVE','ARCHIVED')));
CREATE INDEX "Sentence_ownerId_archivedAt_idx" ON app."Sentence"("ownerId","archivedAt");
CREATE INDEX "StudySet_ownerId_status_updatedAt_idx" ON app."StudySet"("ownerId",status,"updatedAt");
CREATE TABLE app."PersonalSentenceImport" (
 id text PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES app."AppUser"(id) ON DELETE RESTRICT,
 "setId" text NOT NULL REFERENCES app."StudySet"(id) ON DELETE RESTRICT,
 format text NOT NULL, status text NOT NULL DEFAULT 'PREVIEW', "normalizedRows" jsonb NOT NULL,
 errors jsonb NOT NULL, "payloadHash" text NOT NULL, revision integer NOT NULL DEFAULT 1,
 "setRevision" integer NOT NULL, "expiresAt" timestamp(3) NOT NULL,
 "commitKey" uuid, result jsonb, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "committedAt" timestamp(3)
);
CREATE UNIQUE INDEX "PersonalSentenceImport_ownerId_commitKey_key" ON app."PersonalSentenceImport"("ownerId","commitKey");
CREATE INDEX "PersonalSentenceImport_expiresAt_idx" ON app."PersonalSentenceImport"("expiresAt");
CREATE INDEX "PersonalSentenceImport_ownerId_setId_idx" ON app."PersonalSentenceImport"("ownerId","setId");
-- Guard membership boundaries even for accidental future server writes.
CREATE FUNCTION app.check_content_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app."StudySet" s JOIN app."SentenceVersion" v ON v.id=NEW."sentenceVersionId" JOIN app."Sentence" n ON n.id=v."sentenceId" WHERE s.id=NEW."setId" AND s.scope=n.scope AND s."ownerId" IS NOT DISTINCT FROM n."ownerId") THEN
 RAISE EXCEPTION 'content scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER content_membership_scope BEFORE INSERT OR UPDATE ON app."SetSentence" FOR EACH ROW EXECUTE FUNCTION app.check_content_membership();
CREATE FUNCTION app.check_version_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app."Sentence" s WHERE s.id=NEW."sentenceId" AND ((s.scope='PUBLIC' AND NEW.status <> 'ACTIVE') OR (s.scope='PERSONAL' AND NEW.status='ACTIVE'))) THEN RAISE EXCEPTION 'version scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER version_scope BEFORE INSERT OR UPDATE ON app."SentenceVersion" FOR EACH ROW EXECUTE FUNCTION app.check_version_scope();
