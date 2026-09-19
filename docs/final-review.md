# Final submission review — 19 September 2026

The five Case 1 workflow steps are implemented and exercised with synthetic data. This is a working integration prototype, with a material partial requirement: the brief's literal tamper-proof audit retention is not provided by this free deployment. Do not describe it as fully HIPAA compliant or production ready.

## Requirement results

| Requirement | Result and evidence |
| --- | --- |
| Read original MedicationRequest | Pass within the supported fixed-dose profile. Actual HAPI reads; patient, selected order, status, intent, dose and route checks. |
| Validate formulation through NIH RxNorm | Pass. Live official API, coded SCD/SBD normalization, no display-string matching. Different product codes require review rather than automatic substitution. |
| Parse OMP^O09 with open source library | Pass for the documented interface. Uses the supplied Redox parser, not a handwritten segment parser. This is not a general HL7 conformance validator. |
| Write MedicationDispense with courier and ETA | Pass. Actual HAPI transaction and read-back; preparation/handoff times, courier and documented ETA extension. |
| PHI-free outbound alert and AuditEvent | Alert allowlist and FHIR AuditEvent pass. Immutable retention is partial: HMAC chain and SQL triggers demonstrate tamper detection but cannot protect against privileged replacement, rollback or free-host filesystem resets. |

FHIR R4 4.0.1 is deliberate: it matches the tested HAPI endpoint. The brief's unversioned HL7 links currently describe a different release, so R4 resource definitions were also checked. A local HAPI installation and public HAPI are alternatives; the hosted demo uses the actual public sandbox. Redox and HL7apy are alternatives; only Redox is required for this Node application.

## Defects corrected during this review

- Bound both validation and dispatch to the selected prescription. A pasted message cannot silently select a different valid order.
- Blocked substitutions even when two product codes normalize to the same clinical formulation.
- Rejected hexadecimal/exponent-style dose strings and unsupported FHIR timing, rates and dose limits.
- Prevented stale asynchronous validation from enabling a different selected order.
- Cleared the nurse inbox when its session expires.
- Used standard R4 audit interaction codes, retaining the operational action in outcomeDesc.
- Corrected network-error copy: a lost EHR response can leave an already-committed transaction unconfirmed; retry the same inputs to reconcile.

The existing logo, fonts, colours and layout were preserved.

## Verification evidence

- 22 automated tests passed; zero failures.
- Live HAPI + NLM integration passed, including write/read-back, duplicate suppression, notification field checks and local audit verification: [report](live-verification.json).
- HAPI `$validate` returned no error/fatal issues for Patient, MedicationRequest, MedicationDispense and AuditEvent: [report](fhir-validation.json). Narrative and unavailable terminology/local extension warnings remain. This does not certify clinical safety.
- `npm audit --omit=dev`: zero known dependency vulnerabilities at review time.
- Public deployment browser checks are recorded separately in [deployed verification](deployed-verification.md).

## Assumptions and remaining work

Only synthetic, unscheduled, single fixed-dose subcutaneous insulin orders are supported. Complex prescriptions fail closed. Arrival of the supplied HL7 message plus explicit pharmacy handoff represents the delivery event; a separate nurse indent-entry system is outside this prototype. ETA and temperature are entered by the operator, not GPS/sensor measurements.

The brief does not require an email/password registration system. The demo uses a PKCE launch simulator with protected server sessions. Actual staff identity, separate nurse/pharmacy roles and external SMART registration remain integration work. The nurse app is a polling inbox, not mobile OS push.

Before real clinical use: independently retained immutable audit storage with trusted checkpoints, verified workforce identity and authorization, durable encrypted storage, EHR-side concurrency controls, real courier/recipient provisioning and operational security review are required. Free hosting can sleep or reset local history; public HAPI data is publicly accessible test data.

## Short submission write-up

I built Case 1 as a FHIR R4 pharmacy-to-floor prototype using the public HAPI sandbox, live NIH RxNorm and the supplied Redox HL7 parser. The server validates the selected prescription, patient, coded formulation, dose and route before atomically recording MedicationDispense and AuditEvent, then sends an allowlisted nurse-app alert. I assumed a single fixed-dose insulin order and operator-confirmed courier handoff. The demo uses synthetic PKCE authorization and tamper-evident auditing; with more time I would add real workforce SMART identity, independent immutable audit retention and durable delivery infrastructure.

Submit the live link and repository together. Include this write-up; the repository contains setup instructions and verification evidence. No recruitment email has been sent automatically.

## Sources reviewed

- [MedicationRequest](https://www.hl7.org/fhir/medicationrequest.html) and [R4 definitions](https://hl7.org/fhir/R4/medicationrequest-definitions.html)
- [MedicationDispense](https://www.hl7.org/fhir/medicationdispense.html) and [R4 definitions](https://hl7.org/fhir/R4/medicationdispense-definitions.html)
- [AuditEvent](https://www.hl7.org/fhir/auditevent.html) and [R4](https://hl7.org/fhir/R4/auditevent.html)
- [NIH NLM RxNav APIs](https://lhncbc.nlm.nih.gov/RxNav/APIs/index.html), [concept properties](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getRxConceptProperties.html), [related concepts](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getRelatedByType.html)
- [Redox parser](https://github.com/RedoxEngine/redox-hl7-v2) and alternative [HL7apy](https://github.com/crs4/hl7apy)
- [HAPI starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter) and [public sandbox](https://hapi.fhir.org/)
- [SMART App Launch](https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html)
- [FHIR validation operation](https://hl7.org/fhir/R4/operation-resource-validate.html)

The original recruitment DOCX, its Case 1 hyperlinks and common evaluation guidance were re-read for this review. Cases 2 and 3 are alternatives, not additional scope.
