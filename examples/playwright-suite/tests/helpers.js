const { expect } = require('@playwright/test');

const tcName = (p) => `tc-${p}-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
const tcEmail = (p) => `${tcName(p)}@example.test`;

async function createProduct(request, overrides = {}) {
  const res = await request.post('/products', {
    data: { name: tcName('prod'), price: 9.99, stock: 5, selected: false, ...overrides },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

function expect422(detail, locPath) {
  expect(detail).toBeInstanceOf(Array);
  expect(detail.length).toBeGreaterThan(0);
  for (const d of detail) {
    expect(d).toHaveProperty('loc');
    expect(d).toHaveProperty('msg');
    expect(d).toHaveProperty('type');
  }
  if (locPath) expect(detail.some((d) => d.loc.join('.').includes(locPath))).toBe(true);
}

function expect405(body) {
  expect(body).toEqual({ detail: 'Method Not Allowed' });
}

function expect404Route(body) {
  expect(body).toEqual({ detail: 'Not Found' });
}

module.exports = { tcName, tcEmail, createProduct, expect422, expect405, expect404Route };
