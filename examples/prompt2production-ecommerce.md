# Worked example — Prompt2Production e-commerce API

A real run of all 5 agents against the API documented in
[Madhusudan-1990/Prompt2Production](https://github.com/Madhusudan-1990/Prompt2Production)
(base URL `https://ecommerce-api.fastapicloud.dev`, spec at `/openapi.json`).
Condensed to show the expected shape of every labeled block.

---

## AGENT 1 output (excerpt)

**[EXTRACTED RULES]**

**A. Base & Auth** — Base URL `https://ecommerce-api.fastapicloud.dev`; no authentication anywhere
(no `securitySchemes`, bearer tokens ignored); shared public demo, **no DELETE endpoints** → tag all created data `tc-`.

**B. Endpoints**

| # | Method + Path | Params / Request Body | Codes |
|---|---|---|---|
| 1 | GET `/products` | query (`limit,page,sort,q…` — all ignored) | 200 |
| 2 | POST `/products` | `Product {name:str!, price:number!, stock:int=0, selected:bool!}` | 200, 422 |
| 3 | GET `/products/{id}` | path `product_id:int!` | 200, 404, 422 |
| 4 | PUT `/products/{id}` | `Product` (undocumented but implemented) | 200, 404, 422 |
| 5 | PATCH `/products/{id}/select` | `{selected:bool!}` | 200, 404, 422 |
| 6 | GET/POST `/orders` | `Order {user_id!, product_ids:int[]!, quantities:int[]!}` | 200, 422, **500** |
| 7 | GET/POST `/users` | `User {name:str!, email:str!}` | 200, 422 |
| 8 | GET `/purchases` | query `user_id:int!` required | 200, 422 |
| 9–11 | GET `/admin/stats`, `/debug/db`, `/internal/health` | — (public) | 200 |
| … | + OPTIONS CORS on any path | `Origin` + `Access-Control-Request-Method` | 200, 405 |

**C. Non-existent routes** — `GET /users/{id}`→404 · `PUT/PATCH/DELETE /users/{id}`→405 ·
`/payments`,`/cart`,`/inventory`→ GET 404 / writes 405 · `HEAD /products`→404 ·
`/products/search`→422 `int_parsing` (swallowed by `/{id}` route)

**D. Response-code contract** — creates return **200, never 201** · 404/405 = `{"detail": "<string>"}` ·
422 = `{"detail":[{loc,msg,type}]}` · 500 = **plain text** `text/plain` · malformed JSON → 422 `json_invalid`

**E. Findings** — 1. no format validation (empty name / negative price / invalid email all accepted) ·
2. `POST /orders` uses product id as **list index** → off-by-one `total_cost` ·
3. out-of-range product id → **500** · 4. `PUT` ignores `selected` · 5. all query params ignored ·
6. no rate limiting (no 429, no `X-RateLimit-*`)

---

## AGENT 2 output (excerpt)

**[GENERATED TEST CASES]**

```
TC-001 | GET /products        | Happy path list       | none         | 200, array ≥1, items {id,name,price,stock,selected}
TC-004 | POST /products       | Missing required name | {price,sel}  | 422, detail[0].loc=["body","name"], type="missing"
TC-007 | POST /products       | FINDING: empty name accepted | {name:""} | 200, name persists as ""
TC-017 | PUT /products/{id}   | FINDING: selected ignored | {selected:true} | 200, selected stays false
TC-039 | POST /orders         | FINDING: off-by-one total_cost | user_id:1,[1],qty[2] | 200, total=list[1].price×2 (not id-based)
TC-040 | POST /orders         | BUG: out-of-range product id | product_ids:[999999] | 500, text/plain, body="Internal Server Error"
TC-033 | GET /users/{id}      | Route not implemented | 999999       | 404, detail="Not Found"
TC-069 | OPTIONS /products    | Valid preflight       | Origin+ACRM  | 200 + ACAO/ACAM/ACAC/max-age headers
   ... 72 rows total
```

---

## AGENT 3 output (excerpt)

**[PLAYWRIGHT SCRIPTS]** — runnable project: `package.json`, `playwright.config.js`
(`baseURL`, `retries: 1`), `helpers.js` (`expect422/expect405/expect404Route`, `tc-` name generators), then:

```js
test('TC-040 - BUG: out-of-range product id returns 500 plain text', async ({ request }) => {
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [999999], quantities: [1] } });
  expect(res.status()).toBe(500);
  expect(res.headers()['content-type']).toContain('text/plain');
  expect(await res.text()).toBe('Internal Server Error');
});

test('TC-039 - FINDING: total_cost uses product id as list index (off-by-one)', async ({ request }) => {
  const products = await (await request.get('/products')).json();
  const res = await request.post('/orders', { data: { user_id: 1, product_ids: [1], quantities: [2] } });
  expect(res.status()).toBe(200);
  expect((await res.json()).total_cost).toBeCloseTo(products[1].price * 2, 2);   // index, not id
});
```

Run: `npm i -D @playwright/test && npx playwright test`

---

## AGENT 4 output (excerpt)

**[COVERAGE REPORT]**

- Total Endpoints: 34
- Covered: 30 (88%)
- Response Codes: 5/5 tested (100%) — 200, 404, 405, 422, 500
- Scenario Checks: 4/12 tested (33%)
- Overall Weighted Coverage: 86%
- Gaps Found:

| # | Gap | Type |
|---|-----|------|
| G1 | `GET /docs` never tested | Endpoint |
| G3 | `HEAD /products` → 404 never tested | Endpoint |
| G7 | ACAH echo of requested headers untested | CORS |
| G10 | Burst test: 429 never returned + no `X-RateLimit-*` headers | Security |
| G11 | No stack-trace leak check on 500 bodies | Security |
| … | (16 gap rows total) | |

- Risk Level: **Medium**

---

## AGENT 5 output (excerpt)

**Iteration 1** — 18 new rows (`TC-073`..`TC-090`) closing G1..G16, G18, plus
`tests/09-gap-closing.spec.js`; re-evaluation: endpoints 34/34, codes 5/5, scenario checks 12/12
→ above 90%, loop stops.

**[FINAL COVERAGE SUMMARY]**
- Total Test Cases: 90
- Final Coverage: 96%
- Scripts Ready: Yes
- New Test Cases This Run: TC-073..TC-090 (docs, HEAD, cart/items, filter, CORS-unknown-path, ACAH, perf, burst, stack-trace leak, select-404, include_in_schema, user_id boundaries, unknown query params, nested payload)
- Remaining Risks: no cleanup possible (no DELETE endpoints) · API has zero auth to negative-test · transient 503s on shared demo · 415/content-type negotiation and concurrency out of scope
