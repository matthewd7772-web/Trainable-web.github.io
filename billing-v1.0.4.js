const SUPABASE_URL = 'https://txrsajvaqhqrlpsgjeyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_omyeFX4y5d9FtUUvg0b4Xg_5rO4atSa';
const sessionKey = 'trainable_web_session';
const oauthIntentKey = 'trainable_web_oauth_intent';
const form = document.querySelector('#sign-in-form');
const social = document.querySelector('#social-sign-in');
const signOut = document.querySelector('#sign-out');
const status = document.querySelector('#billing-status');
const plans = document.querySelector('#plans');
const manage = document.querySelector('#manage-billing');

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}
function session() {
  try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); }
  catch { return null; }
}
function saveSession(value) { sessionStorage.setItem(sessionKey, JSON.stringify(value)); }
function authError(result, fallback) {
  return new Error(result.msg || result.error_description || result.message || result.error || fallback);
}
function showSignIn(message, isError = true) {
  sessionStorage.removeItem(sessionKey);
  form.hidden = false;
  social.hidden = false;
  plans.hidden = true;
  manage.hidden = true;
  signOut.hidden = true;
  setStatus(message, isError);
}
function showAccount(current) {
  form.hidden = true;
  social.hidden = true;
  plans.hidden = false;
  manage.hidden = false;
  signOut.hidden = false;
  setStatus(`Signed in as ${current.user?.email || 'your Trainable account'}.`);
}
async function authRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    ...options,
    headers: { apikey: SUPABASE_ANON_KEY, ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw authError(result, 'Could not verify your Trainable account.');
  return result;
}
async function refresh(current) {
  const result = await authRequest('token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  const updated = { ...result, user: result.user || current.user };
  saveSession(updated);
  return updated;
}
async function accessToken() {
  let current = session();
  if (!current?.access_token || !current?.refresh_token) {
    showSignIn('Please sign in to continue.');
    return null;
  }
  try {
    if (current.expires_at && current.expires_at <= Math.floor(Date.now() / 1000) + 60) {
      current = await refresh(current);
    }
    await authRequest('user', { headers: { Authorization: `Bearer ${current.access_token}` } });
    return current.access_token;
  } catch {
    try {
      current = await refresh(current);
      await authRequest('user', { headers: { Authorization: `Bearer ${current.access_token}` } });
      return current.access_token;
    } catch {
      showSignIn('Your session has expired. Please sign in again.');
      return null;
    }
  }
}
async function callFunction(name, token, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw authError(result, 'Something went wrong.');
  return result;
}
async function handleOAuthReturn() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has('access_token') && !hash.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const intent = Number(sessionStorage.getItem(oauthIntentKey));
  sessionStorage.removeItem(oauthIntentKey);
  if (!intent || Date.now() - intent > 10 * 60 * 1000) {
    showSignIn('That sign-in request has expired. Please try again.');
    return true;
  }
  if (hash.has('error')) {
    showSignIn(hash.get('error_description') || 'Could not sign in. Please try again.');
    return true;
  }
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  if (!access_token || !refresh_token) {
    showSignIn('Sign-in did not return a complete session. Please try again.');
    return true;
  }
  try {
    const user = await authRequest('user', { headers: { Authorization: `Bearer ${access_token}` } });
    const expires_in = Number(hash.get('expires_in') || '3600');
    const current = { access_token, refresh_token, user, expires_at: Math.floor(Date.now() / 1000) + expires_in };
    saveSession(current);
    const coachReturn = Number(sessionStorage.getItem('trainable_coach_return'));
    sessionStorage.removeItem('trainable_coach_return');
    if (coachReturn && Date.now() - coachReturn < 10 * 60 * 1000) {
      window.location.replace('/coach/');
      return true;
    }
    showAccount(current);
  } catch (error) { showSignIn(error.message); }
  return true;
}

social.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-provider]');
  if (!button) return;
  const provider = button.dataset.provider;
  if (provider !== 'google' && provider !== 'apple') return;
  sessionStorage.setItem(oauthIntentKey, String(Date.now()));
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', `${location.origin}/billing.html`);
  window.location.assign(url.toString());
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Signing in…');
  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;
  try {
    const result = await authRequest('token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    saveSession(result);
    showAccount(result);
  } catch (error) { setStatus(error.message, true); }
});

plans.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-plan]');
  if (!button) return;
  button.disabled = true;
  const token = await accessToken();
  if (!token) { button.disabled = false; return; }
  setStatus('Opening secure checkout…');
  try {
    const result = await callFunction('create-stripe-checkout', token, { plan: button.dataset.plan });
    window.location.assign(result.url);
  } catch (error) { setStatus(error.message, true); button.disabled = false; }
});

manage.addEventListener('click', async () => {
  manage.disabled = true;
  const token = await accessToken();
  if (!token) { manage.disabled = false; return; }
  setStatus('Opening billing management…');
  try {
    const result = await callFunction('create-stripe-portal', token);
    window.location.assign(result.url);
  } catch (error) { setStatus(error.message, true); manage.disabled = false; }
});
signOut.addEventListener('click', () => showSignIn('Signed out.', false));

async function start() {
  if (await handleOAuthReturn()) return;
  if (session()?.access_token) {
    const token = await accessToken();
    if (token) showAccount(session());
  }
  const query = new URLSearchParams(location.search);
  if (query.has('success') && session()?.access_token) {
    setStatus('Payment complete. Your Advanced access will appear in Trainable shortly.');
  } else if (query.has('cancelled')) {
    setStatus('Checkout was cancelled.');
  }
}
start();
