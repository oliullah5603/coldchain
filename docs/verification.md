# Verification record

Verified on September 19, 2026 using Node.js 24.14.0 on Windows.

## Automated tests

`npm test`: **22 passed, 0 failed**.

- Prepared dispatch and audit persistence after store restart
- Unauthenticated requests and missing CSRF
- Untrusted SMART issuer and invalid callback state
- Authorization-code redemption with an incorrect PKCE verifier
- FHIR prescription reads scoped by launch context
- Library parsing of OMP^O09 and newline transport variants
- Malformed messages, wrong events, units, routes, and multiple orders
- Official RxNorm clinical-drug formulation comparison
- Patient, dose, and formulation mismatch blocks with no dispense writes
- Cancelled orders, do-not-perform instructions, and ambiguous dosage
- Temperature excursion and unsealed packaging blocks
- Successful atomic chart transaction, exact notification allowlist, duplicate suppression, and conflicting replay
- Lost transaction response with successful idempotent reconciliation
- Terminology outage without silent fallback or release
- Cross-patient isolation for deliveries, resources, and notifications
- Audit mutation protection, tamper detection, and dispatch lock

The two generic `Request failed: Error` lines in test output are expected injected failure scenarios (lost response and terminology outage). Error logging deliberately omits raw messages and upstream bodies.

## External services

`node scripts/live-check.js` completed successfully against `https://hapi.fhir.org/baseR4` and `https://rxnav.nlm.nih.gov/REST`. The report is in `live-verification.json`. It records FHIR R4 metadata verification, synthetic seeding, prescription queries, live RxNorm verification, transaction creation, read-back of both resources, replay handling, notification field checks, and local audit integrity.

The public HAPI service has no SMART authorization provider; the report explicitly distinguishes the local PKCE simulator from HAPI's real FHIR API. A registered external SMART EHR flow, local Docker HAPI instance, independent production identity provider, and mobile OS push gateway were not tested.

## Browser checks

Tested in the Codex browser with a 1440px desktop viewport and narrow mobile layouts, including a 390px nurse inbox with no horizontal overflow.

- SMART demo launch into the correct patient context
- Prescription queue and readable responsive review screen
- Live RxNorm verification and successful courier handoff
- Wrong-formulation block with release disabled
- Delivery history and JSON resource inspector
- Audit chain status and event list
- Separate nurse inbox showing a confirmed delivery with courier and ETA, excluding patient and medication details
- No browser console warnings or errors observed during the main workflow check

`npm audit` reported zero known dependency vulnerabilities at installation. Runtime data and audit keys are excluded from the distributable archive.

## Final regression review

Additional tests cover selected-order mismatch, invalid numeric syntax, unsupported timing/rates/limits, substitution review, expired sessions and incorrect origins. All 22 tests passed. npm audit --omit=dev reported zero known vulnerabilities on 19 September 2026.

HAPI validation returned no error/fatal issues for all four resource types. Narrative, terminology and local-extension warnings remain; see fhir-validation.json and final-review.md.
