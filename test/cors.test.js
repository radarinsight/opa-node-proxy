const test = require('node:test');
const assert = require('node:assert/strict');

function loadAppWithOrigins(origins) {
  process.env.ALLOWED_ORIGINS = origins;
  delete require.cache[require.resolve('../server.js')];
  return require('../server.js').app;
}

function doRequest(app, { method = 'OPTIONS', path = '/', headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = require('node:http').request(
        { hostname: '127.0.0.1', port, path, method, headers },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            server.close();
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );

      req.on('error', (error) => {
        server.close();
        reject(error);
      });

      req.end();
    });
  });
}

test('preflight retorna 204 e reflete origin permitida', async () => {
  const app = loadAppWithOrigins('https://*.lovable.app');
  const response = await doRequest(app, {
    method: 'OPTIONS',
    path: '/opa',
    headers: {
      Origin: 'https://meuapp.lovable.app',
      'Access-Control-Request-Headers': 'x-custom-header',
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'https://meuapp.lovable.app');
  assert.match(response.headers['access-control-allow-headers'], /x-custom-header/i);
});

test('origem fora da allowlist não recebe Access-Control-Allow-Origin', async () => {
  const app = loadAppWithOrigins('https://lovable.dev');
  const response = await doRequest(app, {
    method: 'OPTIONS',
    path: '/opa',
    headers: {
      Origin: 'https://nao-permitido.com',
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});
