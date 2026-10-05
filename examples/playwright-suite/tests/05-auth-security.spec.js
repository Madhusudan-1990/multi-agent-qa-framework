const { test, expect } = require('@playwright/test');

test('TC-056 - Endpoint reachable without any credentials', async ({ request }) => {
  const res = await request.get('/products/1');
  expect(res.status()).toBe(200);
});

test('TC-057 - Bogus bearer token is ignored (identical response)', async ({ request }) => {
  const plain = await (await request.get('/products/1')).json();
  const authed = await request.get('/products/1', { headers: { Authorization: 'Bearer bogus.token.here' } });
  expect(authed.status()).toBe(200);
  expect(await authed.json()).toEqual(plain);
});

test('TC-058 - FINDING: /admin/stats and /debug/db are public', async ({ request }) => {
  expect((await request.get('/admin/stats')).status()).toBe(200);
  expect((await request.get('/debug/db')).status()).toBe(200);
});

test('TC-059 - OpenAPI spec declares no securitySchemes', async ({ request }) => {
  const res = await request.get('/openapi.json');
  expect(res.status()).toBe(200);
  const spec = await res.json();
  expect(spec.components.securitySchemes).toBeUndefined();
  expect(spec.security).toBeUndefined();
});
