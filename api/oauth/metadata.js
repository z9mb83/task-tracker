/**
 * OAuth discovery for the ChatGPT plugin (served at /.well-known/* through vercel.json rewrites).
 *   ?kind=resource -> protected resource metadata for /api/mcp
 *   ?kind=as       -> authorization server metadata
 */
const { baseUrl } = require('../../lib/oauth.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const base = baseUrl(req);
  const kind = String((req.query && req.query.kind) || 'as');
  if (kind === 'resource') {
    return res.status(200).json({
      resource: base + '/api/mcp',
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['tasks'],
      resource_name: 'Task Tracker'
    });
  }
  return res.status(200).json({
    issuer: base,
    authorization_endpoint: base + '/api/oauth/authorize',
    token_endpoint: base + '/api/oauth/token',
    registration_endpoint: base + '/api/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['tasks'],
    client_id_metadata_document_supported: true
  });
};
