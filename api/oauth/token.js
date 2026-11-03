/** POST /api/oauth/token: exchanges a code (with PKCE) or a refresh token for an access token. */
const { verify, pkceOk, newTokens, bodyOf } = require('../../lib/oauth.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); return res.status(204).end(); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'invalid_request' }); }
  const b = bodyOf(req);
  const fail = (error, d) => res.status(400).json({ error, error_description: d });

  if (b.grant_type === 'authorization_code') {
    const c = verify(b.code, 'code');
    if (!c) return fail('invalid_grant', 'The sign-in code is invalid or expired.');
    if (b.redirect_uri && b.redirect_uri !== c.ru) return fail('invalid_grant', 'Redirect URL does not match.');
    if (b.client_id && b.client_id !== c.cid) return fail('invalid_grant', 'Client does not match.');
    if (!pkceOk(b.code_verifier, c.cc)) return fail('invalid_grant', 'PKCE check failed.');
    return res.status(200).json(newTokens(c.cid));
  }
  if (b.grant_type === 'refresh_token') {
    const r = verify(b.refresh_token, 'rt');
    if (!r) return fail('invalid_grant', 'Sign in again.');
    if (b.client_id && b.client_id !== r.cid) return fail('invalid_grant', 'Client does not match.');
    return res.status(200).json(newTokens(r.cid));
  }
  return fail('unsupported_grant_type', 'Use authorization_code or refresh_token.');
};
