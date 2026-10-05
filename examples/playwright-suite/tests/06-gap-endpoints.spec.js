const { test, expect } = require('@playwright/test');
const { expect405, expect404Route } = require('./helpers');

test('TC-060 - GET /payments returns 404 not found', async ({ request }) => {
  const res = await request.get('/payments');
  expect(res.status()).toBe(404);
  expect404Route(await res.json());
});

test('TC-061 - POST /payments returns 405', async ({ request }) => {
  const res = await request.post('/payments', { data: {} });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-062 - GET /cart returns 404 not found', async ({ request }) => {
  const res = await request.get('/cart');
  expect(res.status()).toBe(404);
  expect404Route(await res.json());
});

test('TC-063 - POST /cart returns 405', async ({ request }) => {
  const res = await request.post('/cart', { data: {} });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-064 - GET /inventory returns 404 not found', async ({ request }) => {
  const res = await request.get('/inventory');
  expect(res.status()).toBe(404);
  expect404Route(await res.json());
});

test('TC-065 - FINDING: /products/search swallowed by /{id} route -> 422 int_parsing', async ({ request }) => {
  const res = await request.get('/products/search');
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('int_parsing');
  expect(d.input).toBe('search');
});
