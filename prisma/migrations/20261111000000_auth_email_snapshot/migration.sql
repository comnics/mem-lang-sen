-- Auth UUID is the sole account identity. Email can remain stale when an Auth
-- account changes email or is deleted, so it cannot reserve that email forever.
-- Keep all UUIDs, privileges and learning data unchanged; do not merge accounts.
DROP INDEX "app"."AppUser_email_key";
