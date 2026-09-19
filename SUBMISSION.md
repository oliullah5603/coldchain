# Submission write-up

I built Coldchain for Case 1 as a complete prescription-to-dispatch workflow using FHIR R4, the supplied Redox HL7 parser, and the official NLM RxNorm API. The service checks patient identity, coded drug formulation, dose and route before committing MedicationDispense and AuditEvent together; a nurse inbox then receives only courier and ETA details. I assumed a single fixed-dose subcutaneous order and treated OMP^O09 as the local workflow trigger, with an explicit courier-handoff confirmation. I tested successful and blocked flows, replay recovery, privacy filtering, and audit tampering, plus live reads/writes against the public HAPI sandbox. With more time, I would add independent immutable audit storage, real workforce roles and EHR registration, mobile push delivery, and broader medication/dosing profiles.

The audit trail is append-only and tamper-evident; the prototype does not claim absolute tamper-proof storage or HIPAA certification. Setup and a two-minute demo are in README.md.

The public demo uses synthetic records and simulated clinician identity. On free hosting, local audit/delivery history can reset when the service instance is replaced; durable audit retention requires persistent infrastructure. HAPI and RxNorm availability are external dependencies.
