# Interface contract and assumptions

## Versions and identifiers

- FHIR **R4 4.0.1** throughout. The unversioned links in the brief may resolve to a different release; this project uses R4 deliberately to match the tested HAPI server.
- HL7 **2.5.1**, message **OMP^O09**, one patient and one order, `ORC-1=NW`. The Redox library's OMP_O09 schema uses **RXO**, not RXE. This is an order-message interface, so treating its arrival as a dispatch signal is a **local workflow convention from the brief**, not an assertion that OMP^O09 universally means courier departure. The operator explicitly confirms handoff before chart writes.
- `MSH-3 + MSH-4 + MSH-10 + FHIR server` identifies a message replay. Patient ownership and a fingerprint of parsed clinical fields plus courier/ETA/temperature prevent reusing that key with different data.
- `PID-3`: MR identifier, assigning authority `DNA-DEMO`, maps to FHIR identifier system `https://coldchain.example/fhir/mrn`.
- `ORC-2`: placer order identifier from assigning authority `DNA-DEMO`, maps to `https://coldchain.example/fhir/order`.
- `RXO-1`: coded medication with coding system `RXNORM`. Display text is advisory; the RxNorm API supplies the authoritative concept name and clinical-drug equivalence.
- `RXO-2`: fixed dose; `RXO-4`: UCUM `[IU]`. `RXR-1`: `SC` in `HL70162`, mapped to SNOMED CT `34206005`.
- Missing identifiers, unknown code systems, ambiguous orders, unsupported dose units/routes, multiple orders, compound ingredients, PRN instructions, and complex dose schedules are blocked for pharmacist review.

## Clinical scope

The demo supports only an unscheduled, fixed-dose, single-medication subcutaneous insulin order with exact dose matching. Any timing, rate, dose range or maximum-dose constraint requires review. The selected prescription must match the incoming message. A different RxCUI requires substitution review even when its clinical formulation matches. It is a prescription-consistency check, not a dosing recommendation engine. It does not perform unit conversion, calculate doses, approve therapeutic substitutions, verify administration frequency, check interactions, or establish that a recurring dose is due. Message-level idempotency does not prevent two separately authorized messages for the same prescription; clinical scheduling and dispense-quantity limits require additional policy.

The 2–8°C pack acceptance band, sealed-container checkbox, two synthetic couriers, and maximum 60-minute ETA are **demo operational assumptions**. No IoT sensor, temperature history, cold-chain excursion model, or product-specific stability calculation is claimed. The temperature is manually recorded.

FHIR `MedicationDispense.status=completed` means the **pharmacy dispense** is completed when packed medication is handed to the courier. It does not assert ward receipt or patient administration. `whenPrepared` and `whenHandedOver` are captured at that operator-confirmed handoff. ETA is an extension, not a misuse of the actual handoff timestamp. Courier is a contained Practitioner representing a hospital staff member, with a local performer-function code.

## Notifications

`GET /api/notifications` requires the active server session and filters to its EHR/patient context. `public/nurse.html` polls this channel every five seconds. A notification contains only a fixed title and body, an allowlisted courier display name, and an ETA. Clinical details remain in the protected pharmacy/EHR view. It is not a mobile push provider or pager integration, and the demo shares a session between nurse and pharmacy tabs rather than implementing independent workforce roles.

## Writes and retries

Dispatch re-queries the EHR and terminology service even after a successful browser preview. It persists a prepared outbox job before writing. The FHIR transaction uses conditional POSTs for both resources keyed by unique `_tag` values. Both records commit atomically. A response must be a successful transaction-response before any alert becomes visible.

If the EHR committed but the network response was lost, the outbox remains unconfirmed and sends no alert. Resubmit the **same message and same delivery inputs**: the current prescription is checked again, and conditional creation reconciles without another dispense or remote audit record. A successful local result is subsequently returned directly on replay. A conflicting replay returns HTTP 409. The user must retain/resubmit the original incoming message if the browser closes during an unconfirmed write; there is no automated retry worker or manual reconciliation screen in this version.

An EHR order can change between validation and the write. This prototype rechecks at dispatch but does not implement an EHR-side lock/version precondition across MedicationRequest and MedicationDispense. A cancelled order during reconciliation requires operator investigation. Multi-instance processing, cross-process locks, distributed transaction coordination, and exactly-once mobile push are not claimed.

## Audit and security

Local operational events use the R4 AuditEvent shape and HMAC-SHA256 over canonical event JSON plus the previous event hash. SQL triggers reject updates/deletions through normal application database access. Verification detects modified or reordered records; dispatch stops if integrity fails. The remote dispatch AuditEvent is part of the same EHR transaction as MedicationDispense.

The local demo generates an audit key in `data/audit.key` unless `AUDIT_KEY` is provided. Database and key are excluded from the submission archive. Co-located storage is convenient for evaluation, **not independent tamper-proof custody**. An administrator who controls the database and key can forge a replacement chain; complete tail truncation/rollback also needs an external trusted head/checkpoint to detect. Production needs an independently managed key, immutable/WORM audit retention, access controls, backups, and operational review.

Local operational events identify the gateway service, not a verified human clinician. External workforce identity attribution and role-based access policies remain integration work. The audit screen shows only operational event metadata; it omits clinical references.

Tokens and PKCE verifiers live in expiring server memory. Browser cookies are HttpOnly and SameSite=Lax (Secure under HTTPS), mutation endpoints require a CSRF header, responses use no-store, and upstream bodies/raw HL7/credentials are not logged. Live SMART mode requires HTTPS and trusted issuer/auth origins. In-memory sessions are invalidated by a process restart. The local SQLite clinical/outbox data is not encrypted at rest; production requires encrypted storage and host access controls.

These mechanisms demonstrate privacy and security requirements from the brief. They do not establish organizational HIPAA compliance, certifications, BAAs, retention policy, or clinical validation.
