export class AppError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
export function insist(condition, code, message, status) {
  if (!condition) throw new AppError(code, message, status);
}
export async function jsonFetch(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { throw new AppError('UPSTREAM_UNAVAILABLE', 'A required service is unavailable. No release was authorized.', 503); }
  if (!response.ok) throw new AppError('UPSTREAM_REJECTED', `The upstream service returned HTTP ${response.status}.`, 502);
  try { return await response.json(); }
  catch { throw new AppError('UPSTREAM_INVALID', 'The upstream service returned an invalid response.', 502); }
}
