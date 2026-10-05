const { test, expect } = require('@playwright/test');
const { expect422 } = require('./helpers');

test('TC-049 - GET /purchases with required user_id returns 200 array', async ({ request }) => {
  const res = await request.get('/purchases?user_id=1');
  expect(res.status()).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test('TC-050 - GET /purchases without user_id returns 422 on query', async ({ request }) => {
  const res = await request.get('/purchases');
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('missing');
  expect(d.loc.join('.')).toBe('query.user_id');
});

test('TC-051 - GET /purchases user_id=abc returns 422 int_parsing', async ({ request }) => {
  const res = await request.get('/purchases?user_id=abc');
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('int_parsing');
  expect(d.loc.join('.')).toBe('query.user_id');
});

test('TC-052 - Boundary: unknown user_id returns 200 empty array', async ({ request }) => {
  const res = await request.get('/purchases?user_id=987654321');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('TC-053 - GET /admin/stats returns 200 with integer totals', async ({ request }) => {
  const res = await request.get('/admin/stats');
  expect(res.status()).toBe(200);
  const body = await res.json();
  for (const k of ['total_products', 'total_orders', 'total_users']) {
    expect(typeof body[k]).toBe('number');
  }
});

test('TC-054 - GET /debug/db returns 200 JSON', async ({ request }) => {
  const res = await request.get('/debug/db');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');
});

test('TC-055 - GET /internal/health returns ok status with timestamp', async ({ request }) => {
  const res = await request.get('/internal/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.timestamp).toBeTruthy();
});
