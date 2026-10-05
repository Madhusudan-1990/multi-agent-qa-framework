const { test, expect } = require('@playwright/test');
const { tcName, createProduct, expect422, expect405 } = require('./helpers');

test('TC-001 - GET /products returns 200 with non-empty item array', async ({ request }) => {
  const res = await request.get('/products');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThan(0);
  expect(body[0]).toHaveProperty('id');
});

test('TC-002 - GET /products items have correct schema types', async ({ request }) => {
  const body = await (await request.get('/products')).json();
  for (const p of body) {
    expect(typeof p.id).toBe('number');
    expect(typeof p.name).toBe('string');
    expect(typeof p.price).toBe('number');
    expect(typeof p.stock).toBe('number');
    expect(typeof p.selected).toBe('boolean');
  }
});

test('TC-003 - POST /products creates with 200 (never 201) and echoes fields', async ({ request }) => {
  const name = tcName('create');
  const res = await request.post('/products', { data: { name, price: 9.99, stock: 5, selected: false } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ name, price: 9.99, stock: 5, selected: false });
  expect(Number.isInteger(body.id)).toBe(true);
});

test('TC-004 - POST /products missing name returns 422 with loc body.name', async ({ request }) => {
  const res = await request.post('/products', { data: { price: 1.5, selected: false } });
  expect(res.status()).toBe(422);
  expect422((await res.json()).detail, 'body.name');
});

test('TC-005 - POST /products wrong type price returns 422 float_parsing', async ({ request }) => {
  const res = await request.post('/products', { data: { name: 'tc-type', price: 'abc', selected: false } });
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('float_parsing');
  expect(d.loc.join('.')).toBe('body.price');
});

test('TC-006 - POST /products empty body returns 422 with multiple errors', async ({ request }) => {
  const res = await request.post('/products', { data: {} });
  expect(res.status()).toBe(422);
  expect((await res.json()).detail.length).toBeGreaterThanOrEqual(3);
});

test('TC-007 - FINDING: POST /products accepts empty name', async ({ request }) => {
  const res = await request.post('/products', { data: { name: '', price: 1, selected: false } });
  expect(res.status()).toBe(200);
  expect((await res.json()).name).toBe('');
});

test('TC-008 - FINDING: POST /products accepts negative price', async ({ request }) => {
  const res = await request.post('/products', { data: { name: tcName('neg'), price: -999.99, selected: false } });
  expect(res.status()).toBe(200);
  expect((await res.json()).price).toBe(-999.99);
});

test('TC-009 - FINDING: POST /products accepts negative stock', async ({ request }) => {
  const res = await request.post('/products', { data: { name: tcName('negstock'), price: 1, stock: -5, selected: false } });
  expect(res.status()).toBe(200);
  expect((await res.json()).stock).toBe(-5);
});

test('TC-010 - POST /products ignores extra body fields', async ({ request }) => {
  const res = await request.post('/products', {
    data: { name: tcName('extra'), price: 1, selected: false, junk: 'x', id: 999 },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).not.toHaveProperty('junk');
  expect(body.id).not.toBe(999);
});

test('TC-011 - POST /products wrong type stock returns 422 int_parsing', async ({ request }) => {
  const res = await request.post('/products', { data: { name: tcName('stock'), price: 1, stock: 'abc', selected: false } });
  expect(res.status()).toBe(422);
  expect((await res.json()).detail[0].type).toBe('int_parsing');
});

test('TC-012 - GET /products/{id} returns the created product', async ({ request }) => {
  const created = await createProduct(request);
  const res = await request.get(`/products/${created.id}`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: created.id, name: created.name });
});

test('TC-013 - GET /products/{id} non-existent returns 404 product not found', async ({ request }) => {
  const res = await request.get('/products/999999');
  expect(res.status()).toBe(404);
  expect((await res.json()).detail).toBe('Product not found');
});

test('TC-014 - GET /products/{id} non-integer returns 422 int_parsing on path', async ({ request }) => {
  const res = await request.get('/products/abc');
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('int_parsing');
  expect(d.loc.join('.')).toBe('path.product_id');
});

test('TC-015 - Boundary: GET /products/0 returns 404', async ({ request }) => {
  const res = await request.get('/products/0');
  expect(res.status()).toBe(404);
  expect((await res.json()).detail).toBe('Product not found');
});

test('TC-016 - PUT /products/{id} updates name and price', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.put(`/products/${p.id}`, { data: { name: p.name, price: 19.99, stock: 9, selected: false } });
  expect(res.status()).toBe(200);
  expect((await res.json()).price).toBe(19.99);
  const again = await (await request.get(`/products/${p.id}`)).json();
  expect(again.price).toBe(19.99);
});

test('TC-017 - FINDING: PUT /products/{id} ignores selected field', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.put(`/products/${p.id}`, { data: { name: p.name, price: 9.99, stock: 5, selected: true } });
  expect(res.status()).toBe(200);
  expect((await res.json()).selected).toBe(false);
  const again = await (await request.get(`/products/${p.id}`)).json();
  expect(again.selected).toBe(false);
});

test('TC-018 - PUT /products/{id} with empty body returns 422', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.put(`/products/${p.id}`, { data: {} });
  expect(res.status()).toBe(422);
  expect422((await res.json()).detail, 'body');
});

test('TC-019 - PUT /products/{id} non-existent returns 404', async ({ request }) => {
  const res = await request.put('/products/999999', { data: { name: 'x', price: 1, selected: false } });
  expect(res.status()).toBe(404);
  expect((await res.json()).detail).toBe('Product not found');
});

test('TC-020 - PATCH /products/{id}/select toggles selected to true', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.patch(`/products/${p.id}/select`, { data: { selected: true } });
  expect(res.status()).toBe(200);
  expect((await res.json()).selected).toBe(true);
});

test('TC-021 - PATCH /products/{id}/select missing selected returns 422', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.patch(`/products/${p.id}/select`, { data: {} });
  expect(res.status()).toBe(422);
  expect422((await res.json()).detail, 'body.selected');
});

test('TC-022 - PATCH /products/{id} returns 405 method not allowed', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.patch(`/products/${p.id}`, { data: { selected: true } });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-023 - DELETE /products/{id} returns 405 method not allowed', async ({ request }) => {
  const p = await createProduct(request);
  const res = await request.delete(`/products/${p.id}`);
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-024 - FINDING: pagination query params are ignored', async ({ request }) => {
  const base = (await (await request.get('/products')).json()).length;
  const limited = (await (await request.get('/products?limit=1')).json()).length;
  expect(limited).toBe(base);
});

test('TC-025 - FINDING: sort/filter/search query params are ignored', async ({ request }) => {
  const base = (await (await request.get('/products')).json()).map((p) => p.id);
  const filtered = await (await request.get(
    '/products?sort=price&order_by=name&direction=asc&category=toy&q=zzz&minPrice=1&maxPrice=2&inStock=true&skip=5&take=3'
  )).json();
  expect(filtered.map((p) => p.id)).toEqual(base);
});

test('TC-026 - Edge: 500-char product name accepted and echoed', async ({ request }) => {
  const name = `tc-long-${'x'.repeat(500)}`;
  const res = await request.post('/products', { data: { name, price: 1, selected: false } });
  expect(res.status()).toBe(200);
  expect((await res.json()).name.length).toBe(name.length);
});
