# Coldchain

**Case 1 · Pharmacy Cold Chain to Inpatient Floor · DNA Health recruitment project**

**[Live demo](https://coldchain-jp56.onrender.com)** · **[Source code](https://github.com/oliullah5603/coldchain)**

Select **Connect to EHR** to enter the synthetic demo; no password is needed. The hosted app uses the public HAPI FHIR sandbox and live NLM RxNorm. Free hosting may take about a minute to wake up. This is simulated EHR authorization, not a real staff account.

Coldchain reads an original FHIR prescription, validates an incoming HL7 order against RxNorm, records a pharmacy handoff in the EHR, and delivers a minimal notification to a nurse inbox. A responsive pharmacy desk exposes verification results, delivery history, the submitted FHIR resources, and audit integrity.

## Run locally

For a public HTTPS demo, see [deployment instructions](docs/deployment.md) and the included free Render configuration in `render.yaml`. This is a synthetic-data recruitment prototype. Free hosting can reset local history; real workforce authentication and immutable audit retention require a production deployment.

Requires **Node.js 24 or later** (uses Node's built-in SQLite). No Python, database installation, API key, or paid service is required for the default demo.

```sh
npm ci
npm start
```

Open **http://localhost:4310**, select **Connect to EHR**, and use the generated synthetic patient context. The default mode uses the bundled FHIR sandbox and **live official NLM RxNorm**. The demo OAuth server performs an authorization-code exchange with S256 PKCE; it automatically authorizes synthetic data and is not an identity provider for real users.

The Node SQLite experimental warning is expected on Node 24. The app binds to loopback only. Stop with Ctrl+C.

### A two-minute demonstration

1. Connect to the EHR and select a prescription.
2. Click **Verify prescription & medication**. Patient identity, active prescription, clinical formulation, dose, and route must pass.
3. Keep **Matching medication & dose**, select a courier, set an ETA, enter a packaging temperature between 2 and 8°C, and confirm sealed packaging.
4. Click **Confirm courier handoff**. The application revalidates before dispatch, commits the chart transaction, then exposes the nurse-app alert.
5. Open **Deliveries → View records** to inspect `MedicationDispense`, `AuditEvent`, and the exact notification payload. Open **Audit trail** to inspect the authenticated event chain.
6. Open **http://localhost:4310/nurse.html** in another tab. It polls the protected notification channel every five seconds. Dispatch another synthetic order to see an incoming update.
7. Choose **Different formulation — should block**, then verify again. The example uses a pen injector instead of the prescribed injectable solution, retaining the ingredient and strength to demonstrate why ingredient-only matching is insufficient. **Incorrect dose — should block** demonstrates a separate dose failure.

The HL7 message can be inspected or replaced in the expandable input. A scenario selection generates a distinct message control ID. Resending the same message with the same delivery inputs returns the existing result; changing the inputs under an already-used control ID is rejected.

## Offline mode

Copy `.env.example` to `.env` and set:

```dotenv
RXNORM_MODE=snapshot
```

Restart the server. The UI explicitly labels this mode as recorded RxNorm responses. `fixtures/rxnorm-snapshot.json` contains responses captured from the official API, with source and capture timestamp. There is **no automatic fallback** from live mode: an outage blocks a new release.

## Use the provided HAPI sandbox

The default bundled sandbox makes local evaluation reproducible. The HAPI adapter has also been exercised against the actual public server. See `docs/live-verification.json` for the completed read/write/read-back check.

Set the following in `.env`:

```dotenv
EHR_MODE=hapi
FHIR_BASE_URL=https://hapi.fhir.org/baseR4
RXNORM_MODE=live
```

Then run:

```sh
npm run seed:hapi
npm start
```

The seeder uploads only this project's generated synthetic patient and prescriptions. It uses the same local fixture IDs that the demo launch supplies. **Public HAPI is a public test service without SMART authentication**; this mode uses the local PKCE launch simulator to demonstrate the app's session flow and does not pretend HAPI authenticated a real clinician. No synthetic OAuth bearer token is sent to public HAPI.

For a local HAPI installation, use the supplied official [HAPI FHIR JPA Server Starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter), choose R4, and set `FHIR_BASE_URL=http://localhost:8080/fhir`. Run the same seed command. Local HAPI itself was not run in this environment because Docker was unavailable.

## External SMART EHR configuration

Register this app with a SMART-capable FHIR R4 EHR. Configure HTTPS, `EHR_MODE=smart`, `FHIR_BASE_URL`, `SMART_CLIENT_ID`, and the trusted authorization-server origin in `SMART_ALLOWED_AUTH_ORIGINS`. If the EHR registers it as a confidential client using `client_secret_basic`, also set `SMART_CLIENT_SECRET` **on the server only**.

- Launch URL: `https://your-app.example/auth/launch`
- Callback: `https://your-app.example/auth/callback`
- Supports `iss` and `launch` parameters for an EHR launch, or standalone patient-context launch.
- Requested standalone scopes: `launch/patient patient/Patient.r patient/MedicationRequest.rs patient/Medication.r patient/MedicationDispense.cs user/AuditEvent.cs`.
- An EHR launch requests `launch` instead of `launch/patient`.
- Issuer and authorization origins must match the configured allowlist. Tokens and PKCE verifiers remain in server memory; the browser receives an opaque HttpOnly SameSite cookie and a CSRF token. No bearer token is stored in localStorage.
- Sessions expire with the access token, up to 30 minutes. Refresh-token renewal is deliberately not implemented; launch again.
- This interface uses the documented local identifier systems and single-dose HL7 profile in `docs/interface-contract.md`. A real hospital must map its identifiers and courier directory before use.
- External SMART registration and a real EHR login were not available for end-to-end testing. The protocol path is implemented and the local PKCE flow is tested.

The app currently runs as a top-level window; CSP blocks third-party iframe embedding. Allow only explicitly trusted EHR frame origins if embedding is required.

## Verification

See the [final review](docs/final-review.md) for corrected defects, requirement status and remaining limitations.

```sh
npm test
npm run verify:audit
```

Tests exercise HTTP authentication and FHIR transactions, blocked patient/formulation/dose mismatches, malformed legacy messages, packaging policy, replay conflicts, lost transaction responses, privacy allowlisting, and audit tampering. They run offline using recorded RxNorm data and isolated temporary databases.

To repeat the external integration check (writes synthetic records to public HAPI):

```sh
node scripts/live-check.js
```

`docs/live-verification.json` records the result. Browser checks covered desktop and narrow-screen layouts, successful release, blocked formulation, delivery evidence, audit inspection, and the nurse inbox.

## Architecture

```text
Pharmacy browser ── HttpOnly session + CSRF ── Node/Express gateway
                                                ├─ SMART discovery / OAuth + PKCE
                                                ├─ Redox OMP^O09 parser
                                                ├─ FHIR R4 EHR queries
                                                ├─ NLM RxNorm terminology checks
                                                ├─ Conditional FHIR transaction
                                                │    ├─ MedicationDispense
                                                │    └─ AuditEvent
                                                ├─ SQLite dispatch outbox
                                                └─ Signed, append-only local audit chain
Nurse inbox ── authorized patient-context feed ────┘
```

Backend code is in `src/`; the dependency-free frontend is in `public/`. `test/` holds automated tests. `docs/` explains requirement coverage, interface decisions, security boundaries, and external verification. `fhir/` contains the custom extension definitions.

## Boundaries worth understanding

This is a recruitment prototype with working integrations, not a certified clinical system. It demonstrates the requested privacy controls but does not claim HIPAA certification or absolute tamper-proof storage. The audit design is **append-only and tamper-evident**: SQLite prevents normal updates/deletes, and an HMAC chain detects modification/reordering. A database administrator with both database and key access remains outside this guarantee; independent immutable storage and externally anchored checkpoints are needed for stronger assurance.

The nurse inbox is an implemented in-app delivery channel. Mobile OS push, SMS, pager vendors, recipient provisioning, and acknowledgement/escalation are not integrated. Demo nurse and pharmacy tabs share the synthetic launch session; production nursing roles and ward assignments require real EHR identity and authorization policies.

See `docs/interface-contract.md` for the remaining clinical assumptions, retry behavior, and explicit limitations. **Do not load real patient data into the demo or public sandbox.**
