const { test, expect } = require('@playwright/test');

const ORIGIN = 'https://example.com';

test('TC-069 - Valid preflight returns 200 with full CORS headers', async ({ request }) => {
  const res = await request.fetch('/products', { method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['access-control-allow-origin']).toBe(ORIGIN);
  expect(h['access-control-allow-credentials']).toBe('true');
  expect(h['access-control-max-age']).toBe('600');
  expect(h['access-control-allow-methods']).toBeTruthy();
});

test('TC-070 - Preflight without Access-Control-Request-Method returns 405', async ({ request }) => {
  const res = await request.fetch('/products', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  expect(res.status()).toBe(405);
});

test('TC-071 - Preflight without Origin returns 405', async ({ request }) => {
  const res = await request.fetch('/products', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' } });
  expect(res.status()).toBe(405);
});

test('TC-072 - ACAM advertises GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS', async ({ request }) => {
  const res = await request.fetch('/products', { method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  const methods = res.headers()['access-control-allow-methods'].split(',').map((m) => m.trim());
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    expect(methods).toContain(m);
  }
});
