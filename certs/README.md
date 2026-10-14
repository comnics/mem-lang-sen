# Supabase TLS CA

`supabase-ca.crt` is the public Supabase Root 2021 CA (expires April 26, 2031).
Downloaded from the URL used by the official Supabase dashboard:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Source: https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json
Guidance: https://supabase.com/docs/guides/platform/ssl-enforcement

Local connection URLs use `sslmode=verify-full&sslrootcert=<absolute path to this file>`.
For a deployment, configure a certificate path available in that runtime; never copy a local machine's absolute path to Vercel.
