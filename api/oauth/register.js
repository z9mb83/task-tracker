/** POST /api/oauth/register: dynamic client registration (ChatGPT registers itself). */
const { sign, now, allowedRedirect, bodyOf } = require('../../lib/oauth.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'invalid_request' }); }
  const b = bodyOf(req);
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 10) : [];
  if (!uris.length || !uris.every(allowedRedirect)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Only ChatGPT redirect URLs can be registered.' });
  }
  const name = String(b.client_name || 'ChatGPT').slice(0, 60);
  const issued = now();
  return res.status(201).json({
    client_id: sign({ typ: 'client', ru: uris, n: name, iat: issued }),
    client_id_issued_at: issued,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  });
};
