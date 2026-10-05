const { test, expect } = require('@playwright/test');
const { tcName, tcEmail, expect422, expect405, expect404Route } = require('./helpers');

test('TC-027 - GET /users returns 200 array of users', async ({ request }) => {
  const res = await request.get('/users');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  if (body.length) expect(body[0]).toMatchObject({ id: expect.any(Number), name: expect.any(String), email: expect.any(String) });
});

test('TC-028 - POST /users creates with 200 and returns id', async ({ request }) => {
  const name = tcName('user');
  const email = tcEmail('user');
  const res = await request.post('/users', { data: { name, email } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: expect.any(Number), name, email });
});

test('TC-029 - POST /users missing email returns 422 loc body.email', async ({ request }) => {
  const res = await request.post('/users', { data: { name: tcName('noemail') } });
  expect(res.status()).toBe(422);
  expect422((await res.json()).detail, 'body.email');
});

test('TC-030 - POST /users empty body returns 422 with name+email errors', async ({ request }) => {
  const res = await request.post('/users', { data: {} });
  expect(res.status()).toBe(422);
  const detail = (await res.json()).detail;
  expect(detail.length).toBe(2);
  expect(detail.map((d) => d.loc.join('.'))).toEqual(expect.arrayContaining(['body.name', 'body.email']));
});

test('TC-031 - FINDING: invalid email is accepted and persists', async ({ request }) => {
  const name = tcName('bademail');
  const res = await request.post('/users', { data: { name, email: 'not-an-email' } });
  expect(res.status()).toBe(200);
  expect((await res.json()).email).toBe('not-an-email');
  const list = await (await request.get('/users')).json();
  expect(list.some((u) => u.name === name && u.email === 'not-an-email')).toBe(true);
});

test('TC-032 - FINDING: empty user name accepted', async ({ request }) => {
  const res = await request.post('/users', { data: { name: '', email: tcEmail('empty') } });
  expect(res.status()).toBe(200);
  expect((await res.json()).name).toBe('');
});

test('TC-033 - GET /users/{id} returns 404 route not found', async ({ request }) => {
  const res = await request.get('/users/999999');
  expect(res.status()).toBe(404);
  expect404Route(await res.json());
});

test('TC-034 - PUT /users/{id} returns 405', async ({ request }) => {
  const res = await request.put('/users/1', { data: { name: 'x', email: 'x@y.z' } });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-035 - PATCH /users/{id} returns 405', async ({ request }) => {
  const res = await request.patch('/users/1', { data: { name: 'x', email: 'x@y.z' } });
  expect(res.status()).toBe(405);
  expect405(await res.json());
});

test('TC-036 - DELETE /users/{id} returns 405', async ({ request }) => {
  const res = await request.delete('/users/1');
  expect(res.status()).toBe(405);
  expect405(await res.json());
});
