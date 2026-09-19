# Requirement coverage

| Brief requirement | Implementation | Evidence |
| --- | --- | --- |
| Read the doctor's original prescription with MedicationRequest | Searches the configured FHIR server by patient launch context and order identifier. Checks active status, intent, patient, fixed dose, route, and validity. Supports inline coded medication, contained Medication, or relative Medication reference. | `src/fhir.js`, `src/workflow.js`; HTTP tests and live HAPI check |
| Validate drug formulation using official RxNav/RxNorm | Fetches RxNorm concept properties. SCD codes directly identify ingredient + strength + form; SBD codes map through the official related-SCD endpoint. Ambiguous or ingredient-only concepts fail closed. HL7 display text is not trusted as identity. | `src/rxnorm.js`; live NLM and recorded-response tests |
| Parse OMP^O09 with an open-source library | Uses the specifically supplied `@redoxengine/redox-hl7-v2` parser. Reads MSH/PID/ORC/RXO/RXR from its structured result. Application code does not split raw segments or fields. | `src/hl7.js`, malformed/incorrect-event/multiple-order tests |
| Write MedicationDispense containing packing, courier and ETA | Atomic transaction with the dispense and remote AuditEvent. Records preparation/handoff times, courier performer, prescription link, and documented ETA/temperature extensions. | `src/fhir.js`; live write and read-back |
| Strip identifying PHI from outbound nurse alert | Creates exactly `title`, `body`, `courier`, and `eta` from an allowlist. No patient name, DOB, IDs, medication, room, order ID, or raw HL7 is copied. Protected nurse app receives it only after successful chart confirmation. | `src/workflow.js`, `public/nurse.js`; exact-field and forbidden-value tests |
| Write audit records using AuditEvent and prevent tampering | Remote FHIR AuditEvent plus local AuditEvent-shaped HMAC chain, SQL mutation-blocking triggers, verification command, and dispatch lock when verification fails. Tamper-proof infrastructure limits are disclosed. | `src/store.js`; mutation and tampering tests |
| Use provided FHIR sandbox options | Built-in local demo for reproducibility plus configurable actual HAPI adapter and synthetic seeder. Actual public HAPI integration verified. | `scripts/seed-hapi.js`, `scripts/live-check.js`, `docs/live-verification.json` |
| Avoid brittle string matching | Compares coded RxNorm clinical drugs, UCUM dose units, and mapped route codes. Does not compare medication display-name substrings. | `src/rxnorm.js`, `src/fhir.js` |
| Avoid hand-written legacy parsing | Uses the supplied Redox parser; only normalizes transport newline characters before parsing. | `src/hl7.js` |
| Avoid cleartext browser tokens or hardcoded clinical IDs | OAuth state, S256 PKCE, trusted issuer/endpoint checks, server-held access tokens, opaque HttpOnly cookies, CSRF. Synthetic patient/order IDs are generated and obtained through launch context. | `src/auth.js`, generated fixtures and auth tests |

The original Redox package is deprecated in favor of `@redox-opensource/redox-hl7-v2`. This submission pins the exact package named by the provided repository's README to make the brief's dependency choice explicit. `npm audit` reported no known vulnerabilities at installation. A production maintenance plan should evaluate the successor.

## Supplied references used

- [FHIR MedicationRequest](https://www.hl7.org/fhir/medicationrequest.html), implemented against [R4](https://www.hl7.org/fhir/R4/medicationrequest.html)
- [NLM RxNav APIs](https://lhncbc.nlm.nih.gov/RxNav/APIs/index.html)
- [RxNorm related concept endpoint](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getRelatedByType.html)
- [FHIR MedicationDispense](https://www.hl7.org/fhir/medicationdispense.html), implemented against [R4](https://www.hl7.org/fhir/R4/medicationdispense.html)
- [FHIR AuditEvent](https://www.hl7.org/fhir/auditevent.html), implemented against [R4](https://www.hl7.org/fhir/R4/auditevent.html)
- [Redox HL7 v2 parser](https://github.com/RedoxEngine/redox-hl7-v2)
- [HAPI FHIR JPA Server Starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter)
- [HAPI public sandbox](https://hapi.fhir.org/)
- [SMART App Launch](https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html)
