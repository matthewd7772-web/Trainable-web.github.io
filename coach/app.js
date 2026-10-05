const API = 'https://txrsajvaqhqrlpsgjeyn.supabase.co';
const KEY = 'sb_publishable_omyeFX4y5d9FtUUvg0b4Xg_5rO4atSa';
const SESSION_KEY = 'trainable_web_session';
const OAUTH_KEY = 'trainable_coach_oauth_intent';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const ZONES = [['recovery', 'Z1 · Recovery'], ['endurance', 'Z2 · Endurance'], ['tempo', 'Z3 · Tempo'], ['sweet_spot', 'Sweet spot'], ['threshold', 'Z4 · Threshold'], ['vo2max', 'Z5 · VO₂max'], ['anaerobic', 'Z6 · Anaerobic'], ['open', 'Open effort']];
const TYPES = [['warmup', 'Warm-up'], ['work', 'Work'], ['recovery', 'Recovery'], ['cooldown', 'Cool-down']];
const state = { roster: [], athleteId: null, athlete: null, builder: null, meeting: null, sharedWith: [], trigger: null, editorDirty: false };
const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const title = (value) => String(value ?? '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const dateLabel = (iso) => iso ? new Date(iso.includes('T') ? iso : iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const minutesLabel = (n) => n ? (n >= 60 ? Math.floor(n / 60) + 'h ' + (n % 60 ? (n % 60) + 'm' : '') : n + 'm') : 'Rest';
const localDate = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
const currentWeek = () => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };

function session() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function saveSession(value) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
function setStatus(message, isError = false, area = '#global-status') {
  const node = $(area); if (!node) return; node.textContent = message; node.classList.toggle('is-error', isError);
}
async function authRequest(path, options = {}) {
  const response = await fetch(API + '/auth/v1/' + path, { ...options, headers: { apikey: KEY, ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.error_description || data.message || data.error || 'Could not sign in.');
  return data;
}
async function token() {
  let current = session();
  if (!current?.access_token || !current?.refresh_token) throw new Error('Please sign in again.');
  if (!current.expires_at || current.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    const updated = await authRequest('token?grant_type=refresh_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: current.refresh_token }) });
    current = { ...updated, user: updated.user || current.user }; saveSession(current);
  }
  return current.access_token;
}
async function portal(action, payload = {}) {
  const response = await fetch(API + '/functions/v1/coach-portal', { method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Trainable could not complete that action.');
  return data;
}
function showAuth(message = '') {
  $('#auth-page').hidden = false; $('#workspace').hidden = true; $('#sign-out').hidden = true;
  $('#account-name').textContent = ''; setStatus(message, Boolean(message), '#auth-status');
}
function showWorkspace(email) {
  $('#auth-page').hidden = true; $('#workspace').hidden = false; $('#sign-out').hidden = false;
  $('#account-name').textContent = email || '';
}
function showFieldError(id, message) {
  const input = $('#' + id); const error = $('#' + id + '-error');
  input.setAttribute('aria-invalid', 'true'); error.textContent = message; error.hidden = false;
}
function clearFieldError(id) {
  $('#' + id).removeAttribute('aria-invalid'); $('#' + id + '-error').hidden = true;
}
async function handleOAuth() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has('access_token') && !hash.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const started = Number(sessionStorage.getItem(OAUTH_KEY)); sessionStorage.removeItem(OAUTH_KEY);
  if (!started || Date.now() - started > 10 * 60 * 1000) { showAuth('That sign-in request expired. Try again.'); return true; }
  if (hash.has('error')) { showAuth(hash.get('error_description') || 'Could not sign in.'); return true; }
  const access_token = hash.get('access_token'); const refresh_token = hash.get('refresh_token');
  if (!access_token || !refresh_token) { showAuth('Sign-in did not return a complete session.'); return true; }
  try {
    const user = await authRequest('user', { headers: { Authorization: 'Bearer ' + access_token } });
    saveSession({ access_token, refresh_token, user, expires_at: Math.floor(Date.now() / 1000) + Number(hash.get('expires_in') || 3600) });
    await loadWorkspace();
  } catch (error) { showAuth(error.message); }
  return true;
}
async function loadWorkspace() {
  const result = await portal('bootstrap');
  state.roster = result.roster || []; state.sharedWith = result.shared_with || [];
  showWorkspace(result.email || session()?.user?.email);
  renderRoster();
  const route = location.hash.slice(1).split('/');
  const wanted = ['athlete', 'builder', 'meeting'].includes(route[0]) ? route[1] : null;
  await selectAthlete(state.roster.some((p) => p.id === wanted) ? wanted : state.athleteId && state.roster.some((p) => p.id === state.athleteId) ? state.athleteId : state.roster[0]?.id);
  if (route[0] === 'builder' && wanted === state.athleteId) openBuilder();
  if (route[0] === 'meeting' && wanted === state.athleteId) openMeeting();
}
function renderRoster() {
  $('#roster-count').textContent = String(state.roster.length);
  $('#roster-list').innerHTML = state.roster.map((p) => `<button type="button" class="roster-item ${p.id === state.athleteId ? 'active' : ''}" data-athlete="${safe(p.id)}" aria-current="${p.id === state.athleteId ? 'page' : 'false'}"><strong>${safe(p.display_name || (p.is_self ? 'Your training' : 'Athlete'))}</strong><small>${p.is_self ? 'Your account' : 'Shared with you'} · ${safe(title(p.primary_sport || 'training'))}</small></button>`).join('');
}
async function selectAthlete(id) {
  if (!id) return;
  state.athleteId = id; renderRoster(); $('#athlete-pane').innerHTML = '<p class="list-empty">Loading the training week…</p>';
  try {
    state.athlete = await portal('read_athlete', { athlete_id: id });
    if (location.hash !== '#athlete/' + id) history.replaceState(null, '', '#athlete/' + id);
    renderAthlete();
  } catch (error) { $('#athlete-pane').innerHTML = '<p class="list-empty">' + safe(error.message) + '</p>'; }
}
function renderAthlete() {
  const data = state.athlete; if (!data) return;
  const p = data.profile || {}; const isSelf = state.roster.find((r) => r.id === state.athleteId)?.is_self;
  const week = currentWeek();
  const plan = data.plans.find((x) => x.week_start_date === week);
  const workouts = data.workouts.filter((x) => x.plan_id === plan?.id);
  const name = p.display_name || (isSelf ? 'Your training' : 'Athlete');
  const maxActivity = data.activities[0];
  const readiness = data.readiness;
  const metrics = data.metrics;
  const cells = [
    ['Form', metrics?.tsb == null ? '—' : Math.round(metrics.tsb), metrics?.metric_date ? 'As of ' + dateLabel(metrics.metric_date) : 'No load data yet'],
    ['Fitness', metrics?.ctl == null ? '—' : Math.round(metrics.ctl), 'Chronic load'],
    ['FTP', data.zones?.ftp_watts ? Math.round(data.zones.ftp_watts) + ' W' : '—', 'Current cycling threshold'],
    ['Recovery', readiness?.checkin_energy ? readiness.checkin_energy + ' / 5' : readiness?.hrv_ms ? Math.round(readiness.hrv_ms) + ' ms' : '—', readiness?.metric_date ? 'As of ' + dateLabel(readiness.metric_date) : 'No check-in yet'],
  ];
  const weekRows = ORDER.map((day) => {
    const w = workouts.find((x) => x.day_of_week === day);
    return `<div class="week-row ${w ? '' : 'empty'}"><span class="day-label">${DAYS[day]}</span><div><div class="workout-title">${safe(w?.headline || w?.description?.split('.')[0] || 'Open day')}</div><div class="workout-sub">${w ? safe(title(w.workout_type)) + (w.completed ? ' · Completed' : '') : 'No session planned'}</div></div><div class="workout-meta">${w ? safe(minutesLabel(w.target_duration_min)) : '—'}<span class="${w?.prescription_source === 'human_coach' ? 'coach-owned' : ''}">${w?.prescription_source === 'human_coach' ? 'Coach' : w ? 'Trainable' : ''}</span></div></div>`;
  }).join('');
  const meetingRows = data.meetings.length ? data.meetings.map((m, mi) => `<div class="meeting-row"><strong>${safe(dateLabel(m.happened_at))} · Coach call</strong><p>${safe(m.summary)}</p>${m.meeting_url ? '<small>Google Meet linked</small>' : ''}<div class="meeting-changes">${(m.proposed_changes || []).map((c, ci) => `<button type="button" data-change="${mi}:${ci}">Draft workout from: ${safe(c)}</button>`).join('')}</div></div>`).join('') : '<div class="list-empty"><strong>No coach calls yet</strong><p>Review a Google Meet transcript to turn agreed changes into a clear plan.</p><button type="button" class="secondary small-button" data-action="new-meeting">Add call notes</button></div>';
  const activityRows = data.activities.length ? data.activities.slice(0, 4).map((a) => `<div class="activity-row"><strong>${safe(title(a.sport_type))} · ${safe(minutesLabel(Math.round(a.duration_s / 60)))}</strong><br><small>${safe(dateLabel(a.start_date))}${a.raw_tss ? ' · ' + Math.round(a.raw_tss) + ' TSS' : ''}</small></div>`).join('') : '<div class="list-empty">Recent activities will appear after a training source syncs.</div>';
  $('#athlete-pane').innerHTML = `<div class="athlete-top"><div><p class="eyebrow">${isSelf ? 'YOUR ATHLETE PROFILE' : 'SHARED ATHLETE'}</p><h2>${safe(name)}</h2><p>${safe(title(p.primary_sport || 'Training'))} · Week of ${safe(dateLabel(week))}</p></div><div class="athlete-actions"><button type="button" class="secondary small-button" data-action="review-week">Ask assistant to review</button><button type="button" class="secondary small-button" data-action="new-meeting">Add call notes</button><button type="button" class="primary small-button" data-action="new-workout">Create workout</button></div></div><div class="metrics">${cells.map((c) => `<div class="metric"><span>${safe(c[0])}</span><strong>${safe(c[1])}</strong><small>${safe(c[2])}</small></div>`).join('')}</div><div class="section-head"><h3>This week</h3><small>${safe(dateLabel(week))}–${safe(dateLabel(new Date(new Date(week + 'T12:00:00Z').getTime() + 6 * 86400000).toISOString()))}</small></div><div class="week-list">${weekRows}</div><p class="foot-note">Coach prescriptions are protected when Trainable replans open days. A saved workout also appears in the athlete app.</p><div class="two-column"><section><div class="section-head"><h3>Recent training</h3></div><div class="activity-list">${activityRows}</div></section><section><div class="section-head"><h3>Coach calls</h3></div><div class="meeting-list">${meetingRows}</div></section></div>`;
}
function openDrawer(kicker, titleText, markup) {
  state.trigger = document.activeElement;
  $('#drawer').classList.remove('page-mode'); $('#drawer').setAttribute('role', 'dialog'); $('#drawer').setAttribute('aria-modal', 'true');
  $('#drawer-kicker').textContent = kicker; $('#drawer-title').textContent = titleText; $('#drawer-body').innerHTML = markup;
  $('#close-drawer').textContent = 'Close'; $('#drawer-backdrop').hidden = false; $('#drawer').hidden = false;
  document.body.style.overflow = 'hidden'; $('#close-drawer').focus();
}
function openEditor(route, kicker, titleText, markup) {
  if (!$('#drawer').classList.contains('page-mode')) state.trigger = document.activeElement;
  $('#drawer').classList.add('page-mode'); $('#drawer').setAttribute('role', 'main'); $('#drawer').removeAttribute('aria-modal');
  $('#drawer-kicker').textContent = kicker; $('#drawer-title').textContent = titleText; $('#drawer-body').innerHTML = markup;
  $('#close-drawer').textContent = 'Back to week'; $('#drawer-backdrop').hidden = true; $('#drawer').hidden = false;
  $('#workspace').hidden = true; document.body.style.overflow = '';
  if (location.hash !== '#' + route + '/' + state.athleteId) history.replaceState(null, '', '#' + route + '/' + state.athleteId);
  window.scrollTo(0, 0);
}
function closeDrawer(force = false) {
  const wasPage = $('#drawer').classList.contains('page-mode');
  if (wasPage && state.editorDirty && !force) { $('#discard-dialog').showModal(); $('#keep-draft').focus(); return; }
  $('#drawer').hidden = true; $('#drawer-backdrop').hidden = true; document.body.style.overflow = '';
  $('#drawer').classList.remove('page-mode');
  if (wasPage) { $('#workspace').hidden = false; history.replaceState(null, '', '#athlete/' + state.athleteId); }
  state.builder = null; state.meeting = null; state.editorDirty = false;
  if (state.trigger?.isConnected) state.trigger.focus(); state.trigger = null;
}
function optionMarkup(options, selected) { return options.map(([value, label]) => `<option value="${safe(value)}" ${value === selected ? 'selected' : ''}>${safe(label)}</option>`).join(''); }
function builderBlocksMarkup() {
  return state.builder.blocks.map((b, i) => `<div class="block-row" data-block="${i}" draggable="true"><div><label for="block-type-${i}">Block</label><select id="block-type-${i}" data-block-field="type">${optionMarkup(TYPES, b.type)}</select></div><div><label for="block-zone-${i}">Zone</label><select id="block-zone-${i}" data-block-field="zone">${optionMarkup(ZONES, b.zone)}</select></div><div><label for="block-duration-${i}">Minutes</label><input id="block-duration-${i}" data-block-field="duration_min" type="number" min="1" max="180" value="${safe(b.duration_min)}"></div><div class="move-controls"><button type="button" class="icon-button" data-move="${i}:-1" aria-label="Move block ${i + 1} up">↑</button><button type="button" class="icon-button" data-move="${i}:1" aria-label="Move block ${i + 1} down">↓</button><button type="button" class="icon-button" data-remove="${i}" aria-label="Remove block ${i + 1}">×</button></div></div>`).join('');
}
function captureBuilder() {
  if (!state.builder) return;
  state.builder.prompt = $('#workout-prompt')?.value || '';
  state.builder.day_of_week = Number($('#workout-day')?.value ?? state.builder.day_of_week);
  state.builder.headline = $('#workout-headline')?.value || '';
  state.builder.description = $('#workout-description')?.value || '';
  state.builder.why_line = $('#workout-why')?.value || '';
  state.builder.blocks = [...$('#block-list').querySelectorAll('.block-row')].map((row) => ({
    type: row.querySelector('[data-block-field="type"]').value,
    zone: row.querySelector('[data-block-field="zone"]').value,
    duration_min: Number(row.querySelector('[data-block-field="duration_min"]').value),
  }));
}
function renderBuilder() {
  const b = state.builder;
  const total = b.blocks.reduce((sum, x) => sum + Number(x.duration_min || 0), 0);
  const todayIndex = (new Date().getDay() + 6) % 7;
  const days = ORDER.filter((d) => (d + 6) % 7 >= todayIndex).map((d) => [String(d), DAYS[d]]);
  openEditor('builder', 'WORKOUT BUILDER', 'Create a session', `<p>Describe the ride, then shape each block. The assistant only drafts; saving is your decision.</p><div class="prompt-box"><label for="workout-prompt">Ask the assistant</label><textarea id="workout-prompt" placeholder="3 hours of Z2 with short bursts at the end">${safe(b.prompt)}</textarea><button type="button" class="secondary" data-draft>Draft workout</button><p id="draft-status" class="status" role="status"></p></div><div class="form-group"><label for="workout-day">Day this week</label><select id="workout-day">${optionMarkup(days, String(b.day_of_week))}</select></div><div class="form-group"><label for="workout-headline">Workout title</label><input id="workout-headline" maxlength="60" value="${safe(b.headline)}" placeholder="Long endurance with late surges"></div><div class="form-group"><label for="workout-description">Athlete instructions</label><textarea id="workout-description" rows="3" placeholder="Ride steadily in Z2, then finish with short controlled bursts.">${safe(b.description)}</textarea></div><div class="form-group"><label for="workout-why">Why this session</label><textarea id="workout-why" rows="2" placeholder="Build aerobic durability without a full intensity day.">${safe(b.why_line)}</textarea></div><div class="form-group"><label>Session blocks</label><div id="block-list" class="block-list">${builderBlocksMarkup()}</div><div class="builder-total"><span>Total planned time</span><strong id="builder-duration">${safe(minutesLabel(total))}</strong></div><button type="button" class="secondary" data-add-block>Add block</button><p class="helper">Drag blocks to reorder on desktop, or use the move buttons. Power targets follow the athlete’s FTP. The safety limit can shorten a session before it reaches the app.</p></div><p id="builder-error" class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="primary" data-save-workout>Save to athlete’s week</button><button type="button" class="quiet" data-close>Cancel</button></div>`);
  $('#workout-prompt').focus();
}
function openBuilder(prompt = '', day = new Date().getDay()) {
  state.editorDirty = false;
  state.builder = { prompt, day_of_week: day, headline: '', description: '', why_line: '', workout_type: 'endurance', intent: 'aerobic_base', blocks: [{ type: 'work', zone: 'endurance', duration_min: 60 }] };
  renderBuilder();
}
async function draftWorkout() {
  captureBuilder(); const b = state.builder;
  if (b.prompt.trim().length < 8) { $('#draft-status').textContent = 'Describe the workout in a sentence first.'; return; }
  $('#draft-status').textContent = 'Drafting the session…';
  try {
    const result = await portal('draft_workout', { athlete_id: state.athleteId, client_date: localDate(), prompt: b.prompt });
    state.builder = { ...b, ...result.draft, prompt: b.prompt, day_of_week: b.day_of_week };
    state.editorDirty = true;
    renderBuilder(); $('#draft-status').textContent = 'Draft ready. Review the blocks before saving.';
  } catch (error) { setStatus(error.message, true, '#draft-status'); }
}
async function saveWorkout() {
  captureBuilder(); const b = state.builder;
  if (!b.headline.trim()) { $('#builder-error').textContent = 'Add a workout title.'; $('#workout-headline').focus(); return; }
  if (!b.blocks.length) { $('#builder-error').textContent = 'Add at least one session block.'; return; }
  if (b.blocks.some((x) => !Number.isInteger(x.duration_min) || x.duration_min < 1 || x.duration_min > 180)) { $('#builder-error').textContent = 'Each block needs 1–180 minutes.'; return; }
  $('#builder-error').textContent = 'Saving the workout…';
  try {
    const result = await portal('save_workout', { athlete_id: state.athleteId, client_date: localDate(), week_start_date: currentWeek(), day_of_week: b.day_of_week,
      headline: b.headline, description: b.description, why_line: b.why_line, workout_type: b.workout_type, intent: b.intent, blocks: b.blocks });
    closeDrawer(true); await selectAthlete(state.athleteId);
    setStatus(result.safety_adjusted ? 'Workout saved. Trainable shortened it to the athlete’s safety limit; review the updated duration.' : 'Workout saved to the athlete’s live week.');
  } catch (error) { $('#builder-error').textContent = error.message; }
}
async function reviewWeek() {
  setStatus('The assistant is reviewing the week…');
  try {
    const result = await portal('suggest_week', { athlete_id: state.athleteId, client_date: localDate() });
    const d = result.draft;
    state.editorDirty = true;
    state.builder = { ...d, prompt: '', day_of_week: result.suggested_day_of_week };
    renderBuilder(); $('#draft-status').textContent = 'Assistant suggestion. Check the day and blocks before saving.';
    setStatus('');
  } catch (error) { setStatus(error.message, true); }
}
function meetingMarkup() {
  const m = state.meeting;
  return `<p>Paste a Google Meet transcript after the call. Trainable drafts minutes and suggestions for your review. The transcript is not saved.</p><div class="form-group"><label for="meeting-link">Google Meet link</label><input id="meeting-link" type="url" value="${safe(m.meeting_url)}" placeholder="https://meet.google.com/abc-defg-hij"></div><div class="form-group"><label for="meeting-date">Call date and time</label><input id="meeting-date" type="datetime-local" value="${safe(m.happened_at)}"></div><div class="prompt-box"><label for="meeting-transcript">Transcript</label><textarea id="meeting-transcript" rows="7" placeholder="Paste the call transcript here">${safe(m.transcript)}</textarea><button type="button" class="secondary" data-analyze-minutes>Draft minutes</button><p id="minutes-status" class="status" role="status"></p></div><div class="form-group"><label for="meeting-summary">Summary for the athlete</label><textarea id="meeting-summary" rows="4">${safe(m.summary)}</textarea></div><div class="form-group"><label for="meeting-decisions">Agreed decisions</label><textarea id="meeting-decisions" rows="4" placeholder="One decision per line">${safe(m.decisions)}</textarea></div><div class="form-group"><label for="meeting-changes">Possible workout changes</label><textarea id="meeting-changes" rows="4" placeholder="One suggestion per line">${safe(m.proposed_changes)}</textarea><p class="helper">These stay as suggestions until you create and save a workout.</p></div><p id="meeting-error" class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="primary" data-save-minutes>Save reviewed minutes</button><button type="button" class="quiet" data-close>Cancel</button></div>`;
}
function captureMeeting() {
  const m = state.meeting;
  m.meeting_url = $('#meeting-link').value.trim(); m.happened_at = $('#meeting-date').value;
  m.transcript = $('#meeting-transcript').value; m.summary = $('#meeting-summary').value;
  m.decisions = $('#meeting-decisions').value; m.proposed_changes = $('#meeting-changes').value;
}
function openMeeting() {
  const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  state.editorDirty = false;
  state.meeting = { meeting_url: '', happened_at: local, transcript: '', summary: '', decisions: '', proposed_changes: '' };
  openEditor('meeting', 'GOOGLE MEET NOTES', 'Review a coach call', meetingMarkup());
  $('#meeting-link').focus();
}
async function analyzeMinutes() {
  captureMeeting(); const m = state.meeting;
  if (m.transcript.trim().length < 40) { $('#minutes-status').textContent = 'Paste at least a few lines of transcript.'; return; }
  $('#minutes-status').textContent = 'Drafting minutes…';
  try {
    const result = await portal('analyze_minutes', { athlete_id: state.athleteId, transcript: m.transcript });
    m.summary = result.minutes.summary; m.decisions = result.minutes.decisions.join('\n');
    m.proposed_changes = result.minutes.proposed_changes.join('\n');
    state.editorDirty = true;
    openEditor('meeting', 'GOOGLE MEET NOTES', 'Review a coach call', meetingMarkup());
    $('#minutes-status').textContent = 'Draft ready. Edit and save the minutes you agree with.';
  } catch (error) { setStatus(error.message, true, '#minutes-status'); }
}
async function saveMinutes() {
  captureMeeting(); const m = state.meeting;
  if (!m.summary.trim()) { $('#meeting-error').textContent = 'Add a short summary before saving.'; $('#meeting-summary').focus(); return; }
  $('#meeting-error').textContent = 'Saving minutes…';
  try {
    await portal('save_minutes', { athlete_id: state.athleteId, meeting_url: m.meeting_url,
      happened_at: new Date(m.happened_at).toISOString(), summary: m.summary,
      decisions: m.decisions.split('\n').map((s) => s.trim()).filter(Boolean),
      proposed_changes: m.proposed_changes.split('\n').map((s) => s.trim()).filter(Boolean) });
    closeDrawer(true); await selectAthlete(state.athleteId); setStatus('Reviewed minutes saved. Workout ideas are still suggestions.');
  } catch (error) { $('#meeting-error').textContent = error.message; }
}
function invitePanel() {
  openDrawer('ATHLETE ACCESS', 'Invite your coach', `<p>Create a one-time code and share it privately with your coach. They sign in to Trainable and choose “Use invite code.” You can remove access here at any time.</p><button type="button" class="primary" data-create-invite>Create invite code</button><div id="invite-result"></div><div class="section-head"><h3>Coaches with access</h3></div><div class="meeting-list">${state.sharedWith.length ? state.sharedWith.map((x) => `<div class="meeting-row"><strong>${safe(x.display_name || 'Coach account')}</strong><p>Connected ${safe(dateLabel(x.created_at))}</p><button type="button" class="secondary small-button" data-revoke="${safe(x.coach_id)}">Remove access</button></div>`).join('') : '<div class="list-empty">No coach has access yet.</div>'}</div>`);
}
async function createInvite() {
  const box = $('#invite-result'); box.textContent = 'Creating invite…';
  try {
    const result = await portal('create_invite');
    const workspaceUrl = location.origin + '/coach/';
    box.innerHTML = `<p class="helper">Valid for seven days and one use. Send your coach this workspace address and code. Trainable does not show the code again.</p><p><a href="${safe(workspaceUrl)}">${safe(workspaceUrl)}</a></p><div class="invite-code">${safe(result.code)}</div><button class="secondary" type="button" data-copy-code>Copy invitation</button>`;
    box.dataset.code = 'Open ' + workspaceUrl + ' and sign in to Trainable. Choose “Use invite code” and enter: ' + result.code;
  } catch (error) { box.textContent = error.message; }
}
function joinPanel() {
  openDrawer('COACH ACCESS', 'Join an athlete', '<p>Ask the athlete for their one-time code. After you connect, their live training week appears in your list.</p><div class="form-group"><label for="invite-input">Invite code</label><input id="invite-input" maxlength="48" spellcheck="false" autocomplete="off" placeholder="48-character code"></div><p id="join-error" class="form-error" role="alert"></p><button class="primary" type="button" data-redeem>Connect to athlete</button>');
}
async function redeemInvite() {
  const code = $('#invite-input').value.trim();
  if (!/^[0-9a-f]{48}$/i.test(code)) { $('#join-error').textContent = 'Enter the complete 48-character code.'; return; }
  $('#join-error').textContent = 'Connecting…';
  try { const result = await portal('redeem_invite', { code }); closeDrawer(); await loadWorkspace(); await selectAthlete(result.athlete_id); setStatus('Athlete connected. You can now see the live training week.'); }
  catch (error) { $('#join-error').textContent = error.message; }
}

$('#sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearFieldError('email'); clearFieldError('password');
  const email = $('#email').value.trim(); const password = $('#password').value;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFieldError('email', 'Enter an email like name@example.com.'); $('#email').focus(); return; }
  if (!password) { showFieldError('password', 'Enter your password.'); $('#password').focus(); return; }
  setStatus('Signing in…', false, '#auth-status');
  try { const current = await authRequest('token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); saveSession(current); await loadWorkspace(); }
  catch (error) { setStatus(error.message, true, '#auth-status'); }
});
for (const id of ['email', 'password']) {
  $('#' + id).addEventListener('blur', () => { if (!$('#' + id).value.trim()) showFieldError(id, id === 'email' ? 'Enter your email.' : 'Enter your password.'); });
  $('#' + id).addEventListener('focus', () => clearFieldError(id));
  $('#' + id).addEventListener('input', () => clearFieldError(id));
}
for (const [id, provider] of [['google-sign-in', 'google'], ['apple-sign-in', 'apple']]) {
  $('#' + id).addEventListener('click', () => {
    sessionStorage.setItem(OAUTH_KEY, String(Date.now()));
    sessionStorage.setItem('trainable_web_oauth_intent', String(Date.now()));
    sessionStorage.setItem('trainable_coach_return', String(Date.now()));
    const url = new URL(API + '/auth/v1/authorize');
    url.searchParams.set('provider', provider); url.searchParams.set('redirect_to', location.origin + '/billing.html');
    location.assign(url.toString());
  });
}
$('#sign-out').addEventListener('click', async () => {
  try { await authRequest('logout', { method: 'POST', headers: { Authorization: 'Bearer ' + await token() } }); } catch {}
  sessionStorage.removeItem(SESSION_KEY); state.roster = []; state.athlete = null; state.athleteId = null; showAuth('');
});
$('#roster-list').addEventListener('click', (event) => { const b = event.target.closest('[data-athlete]'); if (b) selectAthlete(b.dataset.athlete); });
$('#athlete-pane').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'new-workout') openBuilder();
  if (action === 'new-meeting') openMeeting();
  if (action === 'review-week') reviewWeek();
  const change = event.target.closest('[data-change]')?.dataset.change;
  if (change) { const [mi, ci] = change.split(':').map(Number); openBuilder(state.athlete.meetings[mi]?.proposed_changes[ci] || ''); }
});
$('#invite-coach').addEventListener('click', invitePanel);
$('#join-team').addEventListener('click', joinPanel);
$('#close-drawer').addEventListener('click', () => closeDrawer());
$('#drawer-backdrop').addEventListener('click', () => closeDrawer());
$('#discard-dialog').addEventListener('close', () => { if ($('#discard-dialog').returnValue === 'confirm') closeDrawer(true); else $('#close-drawer').focus(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#drawer').hidden && !$('#revoke-dialog').open && !$('#discard-dialog').open) closeDrawer();
  if (event.key === 'Tab' && !$('#drawer').hidden && !$('#drawer').classList.contains('page-mode')) {
    const focusable = [...$('#drawer').querySelectorAll('button, input, textarea, select, a[href]')].filter((el) => !el.disabled && !el.hidden);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('#drawer-body').addEventListener('click', async (event) => {
  const el = event.target.closest('button'); if (!el) return;
  if (el.hasAttribute('data-close')) closeDrawer();
  if (el.hasAttribute('data-draft')) draftWorkout();
  if (el.hasAttribute('data-save-workout')) saveWorkout();
  if (el.hasAttribute('data-add-block')) { captureBuilder(); state.editorDirty = true; state.builder.blocks.push({ type: 'work', zone: 'endurance', duration_min: 10 }); renderBuilder(); }
  if (el.hasAttribute('data-remove')) { captureBuilder(); state.editorDirty = true; state.builder.blocks.splice(Number(el.dataset.remove), 1); renderBuilder(); }
  if (el.hasAttribute('data-move')) {
    captureBuilder(); state.editorDirty = true; const [from, offset] = el.dataset.move.split(':').map(Number); const to = from + offset;
    if (to >= 0 && to < state.builder.blocks.length) { const [item] = state.builder.blocks.splice(from, 1); state.builder.blocks.splice(to, 0, item); renderBuilder(); }
  }
  if (el.hasAttribute('data-analyze-minutes')) analyzeMinutes();
  if (el.hasAttribute('data-save-minutes')) saveMinutes();
  if (el.hasAttribute('data-create-invite')) createInvite();
  if (el.hasAttribute('data-copy-code')) {
    try { await navigator.clipboard.writeText($('#invite-result').dataset.code); el.textContent = 'Copied'; }
    catch { el.textContent = 'Select the code above to copy it'; }
  }
  if (el.hasAttribute('data-redeem')) redeemInvite();
  if (el.hasAttribute('data-revoke')) {
    const coachId = el.dataset.revoke; const coach = state.sharedWith.find((x) => x.coach_id === coachId);
    $('#revoke-title').textContent = 'Remove access for ' + (coach?.display_name || 'coach ' + coachId.slice(0, 8)) + '?';
    closeDrawer(true); $('#revoke-dialog').showModal(); $('#keep-access').focus();
    $('#revoke-dialog').addEventListener('close', async function onClose() {
      this.removeEventListener('close', onClose);
      if (this.returnValue !== 'confirm') return;
      try { await portal('revoke_access', { coach_id: coachId }); const result = await portal('bootstrap'); state.sharedWith = result.shared_with || []; invitePanel(); setStatus('Coach access removed.'); }
      catch (error) { setStatus(error.message, true); }
    });
  }
});
let dragged = null;
$('#drawer-body').addEventListener('dragstart', (event) => { const row = event.target.closest('.block-row'); if (!row) return; dragged = Number(row.dataset.block); row.classList.add('dragging'); });
$('#drawer-body').addEventListener('dragover', (event) => { const row = event.target.closest('.block-row'); if (!row || dragged === null) return; event.preventDefault(); row.classList.add('drag-target'); });
$('#drawer-body').addEventListener('dragleave', (event) => { event.target.closest('.block-row')?.classList.remove('drag-target'); });
$('#drawer-body').addEventListener('drop', (event) => {
  const row = event.target.closest('.block-row'); if (!row || dragged === null) return; event.preventDefault();
  const to = Number(row.dataset.block); captureBuilder(); state.editorDirty = true; const [item] = state.builder.blocks.splice(dragged, 1); state.builder.blocks.splice(to, 0, item); dragged = null; renderBuilder();
});
$('#drawer-body').addEventListener('dragend', () => { dragged = null; document.querySelectorAll('.block-row').forEach((row) => row.classList.remove('dragging', 'drag-target')); });
$('#drawer-body').addEventListener('input', (event) => {
  if ($('#drawer').classList.contains('page-mode')) state.editorDirty = true;
  if (event.target.matches('[data-block-field="duration_min"]')) {
    const total = [...document.querySelectorAll('[data-block-field="duration_min"]')].reduce((sum, input) => sum + Number(input.value || 0), 0);
    $('#builder-duration').textContent = minutesLabel(total);
  }
  if (event.target.closest('#drawer-body')) { const err = $('#builder-error') || $('#meeting-error'); if (err) err.textContent = ''; }
});
async function start() {
  if (await handleOAuth()) return;
  if (session()?.access_token) {
    try { await loadWorkspace(); return; } catch { sessionStorage.removeItem(SESSION_KEY); }
  }
  showAuth('');
}
start();
