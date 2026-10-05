const { test, expect } = require('@playwright/test');
const { expect422 } = require('./helpers');

test('TC-066 - Malformed JSON returns 422 json_invalid, not 400', async ({ request }) => {
  const res = await request.post('/products', {
    data: Buffer.from('not-json{'),
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(422);
  expect(res.status()).not.toBe(400);
  const d = (await res.json()).detail[0];
  expect(d.type).toBe('json_invalid');
  expect(d.loc[0]).toBe('body');
});

test('TC-067 - Unknown route returns 404 with detail string', async ({ request }) => {
  const res = await request.get('/nope');
  expect(res.status()).toBe(404);
  expect((await res.json()).detail).toBe('Not Found');
});

test('TC-068 - 404 detail is a string, not a validation array', async ({ request }) => {
  const res = await request.get('/products/999999');
  expect(res.status()).toBe(404);
  expect(typeof (await res.json()).detail).toBe('string');
});
