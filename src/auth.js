import { randomBytes, createHash } from 'node:crypto';
import { insist, jsonFetch } from './errors.js';
const random = () => randomBytes(32).toString('base64url');
export const challenge = verifier => createHash('sha256').update(verifier).digest('base64url');
export const SCOPES = 'launch/patient patient/Patient.r patient/MedicationRequest.rs patient/Medication.r patient/MedicationDispense.cs user/AuditEvent.cs';
function cookie(req, key) { return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${key}=`))?.slice(key.length + 1); }
export function installAuth(app, cfg, store, fixtures) {
  const sessions = new Map(), grants = new Map(), demoTokens = new Map();
  function setSession(res, value) {
    const sid = random(); sessions.set(sid, { ...value, csrf: random(), expires: Date.now() + 1800000 });
    res.cookie('coldchain_session', sid, { httpOnly: true, secure: cfg.origin.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: 1800000 });
    return sid;
  }
  const gc = setInterval(() => {
    for (const map of [sessions, grants, demoTokens]) for (const [key, value] of map) if (value.expires < Date.now()) map.delete(key);
  }, 60000).unref();
  app.use((req, res, next) => {
    const sid = cookie(req, 'coldchain_session');
    const current = sid && sessions.get(sid);
    if (current?.expires > Date.now()) { req.session = current; req.sid = sid; }
    next();
  });
  app.get('/auth/launch', async (req, res) => {
    const issuer = req.query.iss || cfg.fhirBase;
    insist(issuer === cfg.fhirBase, 'UNTRUSTED_ISSUER', 'This EHR issuer is not configured.', 400);
    const discoveryBase = cfg.mode === 'hapi' ? `${cfg.origin}/demo-ehr/fhir` : issuer;
    const metadata = await jsonFetch(`${discoveryBase}/.well-known/smart-configuration`);
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint]) {
      insist(typeof endpoint === 'string' && cfg.authOrigins.includes(new URL(endpoint).origin), 'UNTRUSTED_AUTH', 'The EHR authentication endpoint is not trusted.', 400);
    }
    insist(metadata.code_challenge_methods_supported?.includes('S256'), 'PKCE_UNSUPPORTED', 'The EHR must support S256 PKCE.', 400);
    const state = random(), verifier = random();
    if (req.sid) sessions.delete(req.sid);
    setSession(res, { pending: true, state, verifier, tokenEndpoint: metadata.token_endpoint, fhirBase: issuer });
    const auth = new URL(metadata.authorization_endpoint);
    const launch = typeof req.query.launch === 'string' ? req.query.launch : null;
    const params = { response_type: 'code', client_id: cfg.clientId, redirect_uri: `${cfg.origin}/auth/callback`,
      scope: launch ? SCOPES.replace('launch/patient', 'launch') : SCOPES,
      state, aud: issuer, code_challenge: challenge(verifier), code_challenge_method: 'S256' };
    if (launch) params.launch = launch;
    Object.entries(params).forEach(([key, value]) => auth.searchParams.set(key, value));
    res.redirect(auth.toString());
  });
  app.get('/auth/callback', async (req, res) => {
    const s = req.session;
    insist(s?.pending && typeof req.query.state === 'string' && req.query.state === s.state, 'OAUTH_STATE', 'The sign-in session is invalid or expired. Start again.', 400);
    sessions.delete(req.sid);
    insist(!req.query.error && typeof req.query.code === 'string', 'OAUTH_DENIED', 'The EHR did not authorize this session.', 401);
    const params = new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, client_id: cfg.clientId,
      redirect_uri: `${cfg.origin}/auth/callback`, code_verifier: s.verifier });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cfg.clientSecret && cfg.mode === 'smart') headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64')}`;
    const token = await jsonFetch(s.tokenEndpoint, { method: 'POST', headers, body: params.toString() });
    insist(typeof token.access_token === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(token.patient || ''), 'MISSING_CONTEXT', 'The EHR did not provide an access token and patient launch context.', 401);
    const sid = setSession(res, { patient: token.patient, accessToken: cfg.mode === 'hapi' ? undefined : token.access_token, fhirBase: s.fhirBase });
    sessions.get(sid).expires = Date.now() + Math.min(Number(token.expires_in) || 1800, 1800) * 1000;
    res.redirect('/');
  });
  app.post('/api/logout', (req, res) => {
    insist(req.session && req.headers['x-csrf-token'] === req.session.csrf, 'CSRF', 'Invalid session token.', 403);
    sessions.delete(req.sid); res.clearCookie('coldchain_session', { path: '/' }); res.json({ ok: true });
  });
  // Synthetic OAuth provider is only mounted in explicitly selected demo/test modes.
  if (cfg.mode !== 'smart') {
    app.get('/demo-ehr/fhir/.well-known/smart-configuration', (req, res) => res.json({
      authorization_endpoint: `${cfg.origin}/demo-ehr/authorize`, token_endpoint: `${cfg.origin}/demo-ehr/token`,
      code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code'],
      capabilities: ['launch-standalone', 'context-standalone-patient', 'client-public', 'permission-v2']
    }));
    app.get('/demo-ehr/authorize', (req, res) => {
      const q = req.query;
      insist(q.client_id === cfg.clientId && q.redirect_uri === `${cfg.origin}/auth/callback` && q.aud === cfg.fhirBase && q.response_type === 'code' && q.code_challenge_method === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(q.code_challenge || ''), 'OAUTH_REQUEST', 'Invalid demo authorization request.', 400);
      const code = random(); grants.set(code, { challenge: q.code_challenge, redirect: q.redirect_uri, expires: Date.now() + 60000 });
      const url = new URL(q.redirect_uri); url.searchParams.set('code', code); url.searchParams.set('state', q.state);
      res.redirect(url.toString());
    });
    app.post('/demo-ehr/token', (req, res) => {
      const grant = grants.get(req.body.code); grants.delete(req.body.code);
      insist(grant && grant.expires > Date.now() && req.body.grant_type === 'authorization_code' && req.body.client_id === cfg.clientId && req.body.redirect_uri === grant.redirect && typeof req.body.code_verifier === 'string' && challenge(req.body.code_verifier) === grant.challenge, 'OAUTH_GRANT', 'Invalid or expired authorization grant.', 400);
      const token = random(); demoTokens.set(token, { patient: fixtures.patient.id, expires: Date.now() + 1800000 });
      res.json({ access_token: token, token_type: 'Bearer', expires_in: 1800, patient: fixtures.patient.id, scope: SCOPES });
    });
  }
  return { sessions, demoTokens, close: () => clearInterval(gc), requireSession(req, res, next) {
    try {
      insist(req.session && !req.session.pending, 'AUTH_REQUIRED', 'Launch from the EHR to continue.', 401);
      if (!['GET', 'HEAD'].includes(req.method)) insist(req.headers['x-csrf-token'] === req.session.csrf && (!req.headers.origin || req.headers.origin === cfg.origin), 'CSRF', 'Invalid request origin or session token.', 403);
      next();
    } catch (error) { next(error); }
  } };
}
