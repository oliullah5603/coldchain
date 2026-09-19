const alerts = document.querySelector('#nurse-alerts'), status = document.querySelector('#nurse-status');
let previous = '';
async function refresh() {
  try {
    const response = await fetch('/api/notifications', { credentials: 'same-origin' });
    if (response.status === 401) { previous = ''; alerts.replaceChildren(); status.textContent = 'Sign in through the secure workspace to receive updates.'; return; }
    if (!response.ok) throw new Error('Service unavailable');
    const items = await response.json(); status.textContent = 'Connected · checks for new deliveries every 5 seconds';
    const serialized = JSON.stringify(items); if (serialized === previous) return; previous = serialized;
    alerts.replaceChildren();
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No deliveries yet. New handoffs will appear here automatically.'; alerts.append(empty); }
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'nurse-alert';
      const title = document.createElement('h2'); title.textContent = item.title;
      const body = document.createElement('p'); body.textContent = item.body;
      const meta = document.createElement('p'); meta.className = 'nurse-meta'; meta.textContent = `${item.courier} · Arriving ${new Date(item.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      card.append(title, body, meta); alerts.append(card);
    }
  } catch { status.textContent = 'Connection interrupted. Retrying automatically…'; }
}
refresh(); setInterval(refresh, 5000);
