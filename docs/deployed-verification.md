# Deployed verification — 19 September 2026

URL: https://coldchain-jp56.onrender.com

Render Free Node Web Service successfully deployed application commit `f548d6c`.
All 22 tests passed in the cloud build. The deployment completed in 40.9 seconds.
Hosted mode uses the public HAPI FHIR R4 sandbox and live NLM RxNorm.

Browser checks through the public HTTPS URL after deployment confirmed:

- Synthetic OAuth/PKCE launch loaded three HAPI prescriptions.
- Pasting the first prescription's message while selecting the second was rejected with an explicit prescription mismatch. Courier handoff remained disabled.
- Selecting the matching prescription passed live NLM verification.
- A sealed synthetic courier handoff succeeded, with chart-write confirmation and a dispatched state.
- The nurse inbox displayed only a fixed delivery title/body, courier and ETA, without patient or medication details.
- Signing out in the pharmacy tab cleared the existing nurse card on its next poll and displayed a sign-in prompt.
- No warning/error console entries were observed in the pharmacy tab during this verification.

Earlier deployment checks also exercised the wrong-formulation block, resource inspector and audit screen. The final automated suite covers those backend behaviours and additional safety cases; external integration and validation reports are stored alongside this document.

These checks cover the recruitment demo. Real workforce authentication, regulatory compliance and immutable/durable audit retention are not established. See final-review.md for the requirement gap and clinical assumptions.
