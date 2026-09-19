const $ = selector => document.querySelector(selector);
const state = { session: null, orders: [], samples: [], patient: null, selected: null, valid: false, busy: false, deliveries: [] };
const text = (selector, value) => { $(selector).textContent = value; };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
async function api(path, data) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.session?.csrf || '' }, body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) { $('#application').classList.add('hidden'); $('#login').classList.remove('hidden'); } throw new Error(result.message || 'Request failed.'); }
  return result;
}
function notice(message, error = false) { text('#notice', message); $('#notice').className = `notice${error ? ' error' : ''}`; }
function releaseReady() { $('#dispatch').disabled = !state.valid || state.busy || !$('#sealed').checked || Number($('#temperature').value) < 2 || Number($('#temperature').value) > 8 || !Number.isInteger(Number($('#eta').value)) || Number($('#eta').value) < 1 || Number($('#eta').value) > 60; }
function resetValidation() { state.valid = false; $('#validation-result').replaceChildren(); text('#release-status', 'Awaiting review'); $('#release-status').className = 'badge neutral'; releaseReady(); }
function orderName(order) { return order.medicationCodeableConcept?.coding?.[0]?.display || order.medicationCodeableConcept?.text || 'Medication prescription'; }
function orderDose(order) { const d = order.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity; return d ? `${d.value} ${d.unit || d.code}` : 'Review dosage'; }
function renderOrders() {
  const query = $('#search').value.toLowerCase();
  const orders = state.orders.filter(o => `${orderName(o)} ${o.identifier?.[0]?.value}`.toLowerCase().includes(query));
  $('#order-list').innerHTML = orders.length ? orders.map((o, i) => `<button class="order-option ${state.selected?.id === o.id ? 'selected' : ''}" data-order="${escape(o.id)}"><span class="order-top"><span>${escape(o.identifier?.[0]?.value || o.id)}</span><span class="order-arrow">↗</span></span><strong>${escape(orderName(o))}</strong><span class="order-dose">${escape(orderDose(o))} · Subcutaneous</span><span class="order-caption">${escape(o.note?.[0]?.text || 'Active prescription')}</span></button>`).join('') : '<p class="empty-state">No matching prescriptions.</p>';
  document.querySelectorAll('[data-order]').forEach(button => button.addEventListener('click', () => selectOrder(button.dataset.order)));
}
function selectOrder(id) {
  state.selected = state.orders.find(o => o.id === id); if (!state.selected) return;
  renderOrders(); $('#review-content').classList.remove('hidden'); $('#empty-order').classList.add('hidden');
  text('#medication-name', orderName(state.selected)); text('#dose-label', orderDose(state.selected));
  const name = state.patient.name?.[0]; text('#patient-name', name?.text || [...(name?.given || []), name?.family].filter(Boolean).join(' ') || 'Patient in EHR context');
  text('#patient-context', `MRN ${state.patient.identifier?.[0]?.value || 'From EHR'}`);
  $('#scenario').value = 'message'; $('#sealed').checked = false; loadMessage();
}
function loadMessage() { const sample = state.samples.find(s => s.orderId === state.selected?.id); $('#hl7-message').value = sample?.[$('#scenario').value]?.replaceAll('\r', '\n') || ''; resetValidation(); }
function pushPreview(notification) {
  text('#phone-time', time(new Date()));
  if (!notification) return;
  text('#push-title', notification.title); text('#push-body', notification.body);
  text('#push-meta', `${notification.courier} · ETA ${time(notification.eta)}`); $('#push-meta').classList.remove('hidden');
}
async function refreshOperational() {
  const [deliveries, audit, notifications] = await Promise.all([api('deliveries'), api('audit'), api('notifications')]);
  state.deliveries = deliveries;
  text('#metric-deliveries', deliveries.filter(d => d.state === 'sent').length);
  text('#metric-audit', audit.integrity.valid ? 'Verified' : 'Failed');
  text('#audit-caption', `${audit.integrity.count} authenticated audit events`);
  text('#audit-heading', audit.integrity.valid ? 'Audit chain verified' : 'Integrity failure — dispatch locked');
  $('#audit-list').innerHTML = audit.entries.map(e => `<tr><td>${escape(e.action?.replaceAll('-', ' '))}</td><td>${escape(new Date(e.recorded).toLocaleString())}</td><td><span class="badge ${e.outcome === '0' ? 'success' : 'error'}">${e.outcome === '0' ? 'Success' : 'Blocked / unconfirmed'}</span></td><td title="${escape(e.hash)}">${escape(e.hash.slice(0, 18))}…</td></tr>`).join('') || '<tr><td colspan="4">No events recorded yet.</td></tr>';
  $('#deliveries-list').innerHTML = deliveries.length ? deliveries.map(d => `<div class="delivery-row"><div><h3>${escape(d.result?.medication || 'Dispatch awaiting confirmation')}</h3><p>${escape(new Date(d.created).toLocaleString())}${d.result ? ` · ${escape(d.result.notification.courier)} · ETA ${escape(time(d.result.notification.eta))}` : ' · Retry the same message to reconcile the chart write.'}</p></div><span class="badge ${d.state === 'sent' ? 'success' : 'neutral'}">${d.state === 'sent' ? 'Dispatched' : 'Unconfirmed'}</span><button class="button secondary" data-resource="${escape(d.id)}">View records ↗</button></div>`).join('') : '<div class="empty-state">No deliveries yet. Verify and release an order from the dispatch desk.</div>';
  document.querySelectorAll('[data-resource]').forEach(button => button.addEventListener('click', async () => { try { const resource = await api(`resources/${button.dataset.resource}`); text('#resource-json', JSON.stringify(resource, null, 2)); $('#resource-dialog').showModal(); } catch (e) { notice(e.message, true); } }));
  pushPreview(notifications[0]);
}
async function refresh() {
  const data = await api('orders'); state.orders = data.orders; state.samples = data.samples || []; state.patient = data.patient;
  text('#order-count', state.orders.length); text('#metric-orders', state.orders.length);
  $('#scenario-line').classList.toggle('hidden', !state.samples.length);
  if (state.orders.length) selectOrder(state.selected?.id && state.orders.some(o => o.id === state.selected.id) ? state.selected.id : state.orders[0].id);
  else { state.selected = null; $('#review-content').classList.add('hidden'); $('#empty-order').classList.remove('hidden'); renderOrders(); }
  await refreshOperational();
}
document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b === button));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== `${button.dataset.page}-page`));
  const label = { dispatch: 'Dispatch desk', deliveries: 'Deliveries', audit: 'Audit trail' }[button.dataset.page];
  text('#page-title', label); text('#breadcrumb', label);
  text('#page-description', { dispatch: 'The right medication. A verified order. A safe handoff.', deliveries: 'Follow every confirmed handoff from pharmacy to floor.', audit: 'A verifiable record of checks, decisions, and chart updates.' }[button.dataset.page]);
}));
$('#search').addEventListener('input', renderOrders);
$('#scenario').addEventListener('change', loadMessage);
$('#hl7-message').addEventListener('input', resetValidation);
['#sealed', '#temperature', '#eta'].forEach(s => $(s).addEventListener('input', releaseReady));
$('#validate').addEventListener('click', async () => {
  state.busy = true; $('#validate').disabled = true; releaseReady(); text('#validate', 'Checking prescription and RxNorm…');
  try {
    const result = await api('validate', { message: $('#hl7-message').value }); state.valid = true;
    $('#validation-result').innerHTML = `<div class="validation-checks">${result.checks.map(c => `<span>${escape(c)}</span>`).join('')}</div><p class="validation-source">Verified against ${escape(result.terminology.source)}.</p>`;
    text('#release-status', 'Checks passed'); $('#release-status').className = 'badge success'; $('#notice').classList.add('hidden');
  } catch (e) { state.valid = false; $('#validation-result').innerHTML = `<p class="validation-error">Release blocked: ${escape(e.message)}</p>`; text('#release-status', 'Release blocked'); $('#release-status').className = 'badge error'; }
  finally { state.busy = false; $('#validate').disabled = false; text('#validate', 'Verify prescription & medication →'); releaseReady(); refreshOperational().catch(() => {}); }
});
$('#dispatch').addEventListener('click', async () => {
  state.busy = true; releaseReady(); text('#dispatch', 'Verifying and updating the chart…');
  try {
    const result = await api('dispatch', { message: $('#hl7-message').value, courierId: $('#courier').value, etaMinutes: Number($('#eta').value), temperature: Number($('#temperature').value), sealed: $('#sealed').checked });
    notice(result.duplicate ? 'This handoff was already recorded. No duplicate chart entry or notification was created.' : 'Handoff confirmed. The chart and audit record are saved, and the nurse-app notification is available.');
    pushPreview(result.notification); text('#release-status', 'Dispatched'); $('#release-status').className = 'badge success'; state.valid = false;
    await refreshOperational();
  } catch (e) { notice(e.message, true); }
  finally { state.busy = false; text('#dispatch', 'Confirm courier handoff ↗'); releaseReady(); }
});
$('#refresh').addEventListener('click', async () => { $('#refresh').disabled = true; try { await refresh(); notice('Workspace refreshed from the EHR.'); } catch (e) { notice(e.message, true); } finally { $('#refresh').disabled = false; } });
$('#logout').addEventListener('click', async () => { try { await api('logout', {}); location.reload(); } catch (e) { notice(e.message, true); } });
$('#close-dialog').addEventListener('click', () => $('#resource-dialog').close());
async function initialize() {
  state.session = await api('session');
  const s = state.session;
  text('#environment', s.mode === 'smart' ? 'CONNECTED EHR' : s.mode === 'hapi' ? 'HAPI SYNTHETIC TEST' : 'SYNTHETIC DEMO');
  if (s.mode === 'smart') text('#login-note', 'Connect using your organization’s registered SMART on FHIR authorization service.');
  if (!s.authenticated) return;
  $('#login').classList.add('hidden'); $('#application').classList.remove('hidden'); $('#logout').classList.remove('hidden');
  text('#connection-label', s.mode === 'demo' ? 'Demo EHR connected' : 'FHIR EHR connected');
  text('#mode-note', `${s.mode === 'demo' ? 'Synthetic patient · local FHIR sandbox' : s.mode === 'hapi' ? 'Synthetic patient · HAPI FHIR sandbox' : 'Authorized EHR patient context'}  /  ${s.rxMode === 'live' ? 'Live NLM RxNorm verification' : 'Recorded RxNorm responses · offline demo mode'}`);
  $('#courier').innerHTML = s.couriers.map(c => `<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('');
  await refresh();
}
initialize().catch(e => { $('#application').classList.remove('hidden'); notice(e.message, true); });
