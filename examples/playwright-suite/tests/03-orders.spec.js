const { test, expect } = require('@playwright/test');
const { expect422, expect405, expect404Route } = require('./helpers');

test('TC-037 - GET /orders returns 200 array with order fields', async ({ request }) => {
  const res = await request.get('/orders');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThan(0);
  expect(body[0]).toHaveProperty('total_cost');
});

test('TC-038 - POST /orders creates with 200, status pending', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [1], quantities: [1] } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('pending');
  expect(body.customer_id).toBe(1);
  expect(body.created_at).toBeTruthy();
  expect(Number.isInteger(body.id)).toBe(true);
});

test('TC-039 - FINDING: total_cost uses product id as list index (off-by-one)', async ({ request }) => {
  const products = await (await request.get('/products')).json();
  expect(products.length).toBeGreaterThan(1);
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [1], quantities: [2] } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.total_cost).toBeCloseTo(products[1].price * 2, 2);
  const byId = products.find((p) => p.id === 1);
  if (products[1].id !== 1) expect(body.total_cost).not.toBeCloseTo(byId.price * 2, 2);
});

test('TC-040 - BUG: out-of-range product id returns 500 plain text', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [999999], quantities: [1] } });
  expect(res.status()).toBe(500);
  expect(res.headers()['content-type']).toContain('text/plain');
  expect(await res.text()).toBe('Internal Server Error');
});

test('TC-041 - POST /orders missing user_id returns 422', async ({ request }) => {
  const res = await request.post('/orders', { data: { product_ids: [1], quantities: [1] } });
  expect(res.status()).toBe(422);
  expect422((await res.json()).detail, 'body.user_id');
});

test('TC-042 - Boundary: empty arrays accepted with total_cost 0', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [], quantities: [] } });
  expect(res.status()).toBe(200);
  expect((await res.json()).total_cost).toBe(0);
});

test('TC-043 - FINDING: mismatched product_ids/quantities lengths accepted', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [1], quantities: [2, 3] } });
  expect(res.status()).toBe(200);
});

test('TC-044 - FINDING: negative quantity produces negative total_cost', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [1], quantities: [-2] } });
  expect(res.status()).toBe(200);
  expect((await res.json()).total_cost).toBeLessThan(0);
});

test('TC-045 - POST /orders wrong type user_id returns 422 int_parsing', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 'abc', product_ids: [1], quantities: [1] } });
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('int_parsing');
  expect(d.loc.join('.')).toBe('body.user_id');
});

test('TC-046 - GET /orders/{id} returns 404 route not found', async ({ request }) => {
  const res = await request.get('/orders/999999');
  expect(res.status()).toBe(404);
  expect404Route(await res.json());
});

test('TC-047 - PUT /orders/{id} returns 405', async ({ request }) => {
  const res = await request.put('/orders/1', { data: { user_id: 1, product_ids: [1], quantities: [1] } });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-048 - DELETE /orders/{id} returns 405', async ({ request }) => {
  const res = await request.delete('/orders/1');
  expect(res.status()).toBe(405);
  expect405(await res.json());
});
