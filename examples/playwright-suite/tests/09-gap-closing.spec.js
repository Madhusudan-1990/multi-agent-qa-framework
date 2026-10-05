const { test, expect } = require('@playwright/test');
const { tcName, expect405, expect404Route } = require('./helpers');

test('TC-073 - GET /docs serves Swagger UI', async ({ request }) => {
  const res = await request.get('/docs');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
});

test('TC-074 - GET /openapi.json serves valid spec with 9 paths', async ({ request }) => {
  const res = await request.get('/openapi.json');
  expect(res.status()).toBe(200);
  const spec = await res.json();
  expect(spec.openapi).toMatch(/^3/);
  expect(spec.info.title).toBe('E-Commerce API');
  expect(Object.keys(spec.paths)).toHaveLength(9);
});

test('TC-075 - HEAD /products returns 404 despite CORS advertising HEAD', async ({ request }) => {
  const res = await request.head('/products');
  expect(res.status()).toBe(404);
});

test('TC-076 - PATCH /orders/{id} returns 405', async ({ request }) => {
  const res = await request.patch('/orders/1', { data: { user_id: 1, product_ids: [1], quantities: [1] } });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-077 - GET /cart/items returns 404', async ({ request }) => {
  const res = await request.get('/cart/items');
  expect(res.status()).toBe(404);
  expect404Route(await res.json());
});

test('TC-078 - DELETE /cart/items returns 405', async ({ request }) => {
  const res = await request.delete('/cart/items');
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-079 - FINDING: /products/filter swallowed by /{id} -> 422', async ({ request }) => {
  const res = await request.get('/products/filter');
  expect(res.status()).toBe(422);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('int_parsing');
  expect(d.input).toBe('filter');
});

test('TC-080 - CORS preflight answers unknown paths with 200', async ({ request }) => {
  const res = await request.fetch('/nope', { method: 'OPTIONS',
    headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['access-control-allow-origin']).toBe('https://example.com');
});

test('TC-081 - ACAH echoes requested headers', async ({ request }) => {
  const res = await request.fetch('/products', { method: 'OPTIONS',
    headers: {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-custom',
    },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['access-control-allow-headers']).toBe('content-type,x-custom');
});

test('TC-082 - GET /products responds in under 1500ms', async ({ request }) => {
  const start = Date.now();
  const res = await request.get('/products');
  const elapsed = Date.now() - start;
  expect(res.status()).toBe(200);
  expect(elapsed).toBeLessThan(1500);
});

test('TC-083 - FINDING: 10-call burst never rate-limits (no 429, no limit headers)', async ({ request }) => {
  const statuses = [];
  let sawRateLimitHeader = false;
  for (let i = 0; i < 10; i++) {
    const res = await request.get('/products/1');
    statuses.push(res.status());
    const h = res.headers();
    if (h['x-ratelimit-limit'] || h['x-ratelimit-remaining'] || h['retry-after']) sawRateLimitHeader = true;
  }
  expect(statuses.every((s) => s === 200)).toBe(true);
  expect(statuses).not.toContain(429);
  expect(sawRateLimitHeader).toBe(false);
});

test('TC-084 - 500 body leaks no stack trace', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [999999], quantities: [1] } });
  expect(res.status()).toBe(500);
  const text = await res.text();
  expect(text).not.toMatch(/Traceback|File \"|at .*\(/);
});

test('TC-085 - PATCH select on non-existent product returns 404', async ({ request }) => {
  const res = await request.patch('/products/999999/select', { data: { selected: true } });
  expect(res.status()).toBe(404);
  expect((await res.json()).detail).toBe('Product not found');
});

test('TC-086 - include_in_schema query param is accepted', async ({ request }) => {
  const res = await request.get('/purchases?user_id=1&include_in_schema=true');
  expect(res.status()).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test('TC-087 - Boundary: user_id=0 returns 200 empty array', async ({ request }) => {
  const res = await request.get('/purchases?user_id=0');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('TC-088 - FINDING: user_id existence is never validated', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 999999, product_ids: [1], quantities: [1] } });
  expect(res.status()).toBe(200);
  expect((await res.json()).customer_id).toBe(999999);
});

test('TC-089 - Unknown query params on POST are tolerated', async ({ request }) => {
  const res = await request.post('/products?limit=abc&sort=bad', {
    data: { name: tcName('qparam'), price: 1, selected: false },
  });
  expect(res.status()).toBe(200);
});

test('TC-090 - Deeply nested extra payload ignored, not 500', async ({ request }) => {
  const nested = { a: { b: { c: { d: { e: 'deep' } } } } };
  const res = await request.post('/products', {
    data: { name: tcName('deep'), price: 1, selected: false, extra: nested },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).name).toContain('tc-deep');
});
