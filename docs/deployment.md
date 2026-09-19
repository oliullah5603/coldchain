# Public recruitment demo

Deploy the repository as a Render **Free Web Service**, not a static site.
The checked-in `render.yaml` provides the settings, or enter them manually:

- Node 24.14.0
- Build: `npm ci && npm test`
- Start: `npm run start:hosted`
- Health check: `/healthz`
- `EHR_MODE=hapi`
- `FHIR_BASE_URL=https://hapi.fhir.org/baseR4`
- `RXNORM_MODE=live`
- `AUDIT_KEY`: a newly generated server-only random secret (32+ characters)

Render supplies `PORT` and `RENDER_EXTERNAL_URL`; the app uses this HTTPS URL for
PKCE redirects and secure cookies. Set `APP_ORIGIN` explicitly only for a custom domain.
Startup seeds a generated synthetic patient and prescriptions into public HAPI.
No real patient data, local database, session, or local audit key is uploaded.

## Free hosting limitations

The service can sleep while idle, so the first visit may take time to wake up.
SQLite, local audit history and generated fixtures can reset when the instance is
replaced. Sessions also end on restart. Remote dispense and AuditEvent records
remain subject to the public HAPI sandbox's retention policy. This free demo does
not provide durable or immutable audit retention; it demonstrates the audit
mechanism. Use a persistent disk plus independent immutable audit storage for a
durable deployment. All visitors use the shared synthetic demo patient context.

The public HAPI service is unauthenticated. App login demonstrates PKCE with the
local simulator; it does not establish a real clinician identity. Only synthetic
data belongs in this public recruitment demo. The external SMART adapter is
available for a separately registered real EHR.

## Submission

Reply to the recruitment email with the public HTTPS demo URL, GitHub repository,
and the short write-up in `SUBMISSION.md`. Explain the free demo reset and simulated
identity limitations. Keep a brief walkthrough recording as an optional backup.

Before sharing, verify EHR connection, a successful dispatch, a rejected mismatch,
the nurse inbox and audit integrity through the deployed URL.
