const form = document.getElementById('login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const field = document.getElementById('access-code');
  const button = form.querySelector('button');
  const error = document.getElementById('login-error');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: field.value.trim() }) });
    field.value = '';
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'Sign-in failed.');
    window.location.assign('/');
  } catch (failure) { error.textContent = failure.message || 'Could not connect. Contact the host.'; }
  finally { button.disabled = false; }
});
