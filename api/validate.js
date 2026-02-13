const crypto = require('crypto');

function validate(req) {
  const initData = req.headers['authorization'];
  if (!initData) {
    return { ok: false, error: 'Missing authorization header' };
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    return { ok: false, error: 'Server misconfigured' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'Invalid init data' };
  }

  params.delete('hash');
  const entries = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    return { ok: false, error: 'Invalid signature' };
  }

  // Check auth_date is not too old (allow 24 hours)
  const authDate = parseInt(params.get('auth_date'), 10);
  if (authDate && (Date.now() / 1000 - authDate) > 86400) {
    return { ok: false, error: 'Init data expired' };
  }

  let user = null;
  const userStr = params.get('user');
  if (userStr) {
    try {
      user = JSON.parse(userStr);
    } catch {
      return { ok: false, error: 'Invalid user data' };
    }
  }

  if (!user || !user.id) {
    return { ok: false, error: 'No user in init data' };
  }

  return {
    ok: true,
    userId: String(user.id),
    userName: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown'
  };
}

module.exports = { validate };
