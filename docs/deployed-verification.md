# Deployed verification — 19 September 2026

URL: https://coldchain-jp56.onrender.com

Render Free Node Web Service deployed application commit `2e5461e`.
All 17 tests passed in the cloud build. Runtime seeded four synthetic resources
into the public HAPI FHIR R4 sandbox and started with live NLM RxNorm enabled.

Browser verification through the public HTTPS URL confirmed:

- Connect to EHR completed the synthetic OAuth/PKCE flow.
- Three prescriptions loaded from HAPI for the generated patient context.
- A different formulation was rejected and courier handoff stayed disabled.
- Matching formulation passed live NLM RxNorm verification.
- A sealed synthetic handoff committed the chart and audit records.
- The nurse notification displayed courier and ETA without patient details.
- Audit chain verification succeeded and displayed blocked validation,
  successful validation, dispatch preparation and chart-write confirmation.

This checks the recruitment demo, not real clinician authentication, regulatory
certification, or durable retention on the free hosting filesystem.
