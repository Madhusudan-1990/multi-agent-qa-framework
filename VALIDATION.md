# VALIDATION — evidence that the agents work

Validation date: **2026-10-05** · opencode 1.18.34 · Node v24.18.0 · npm 11.16.0

| # | What was validated | Result |
|---|---|---|
| 1 | Full pipeline (master prompt) against a live API | ✅ See [examples/prompt2production-ecommerce.md](examples/prompt2production-ecommerce.md) — 90 TCs, 96% weighted coverage |
| 2 | Each of the 5 agent files **standalone, in a fresh isolated context** | ✅ **5/5 SMOKE OK** |
| 3 | Input-refusal contracts (agent must stop, not invent) | ✅ **5/5 PASS** |
| 4 | Generated Playwright suite **actually executed** against the live API | ✅ **90/90 passed (23.9s)** |
| 5 | opencode discovers the 5 agents + `/qa-pipeline` command | ✅ **5 agents + 1 command registered** |

---

## 1. Standalone agent smoke tests (fresh context per agent)

Each prompt file was handed to an isolated agent session **with only its required input** — no access to the original conversation — using a small Books API spec (3 endpoints, API-key auth, `204` deletes) to prove the files generalize beyond the e-commerce example.

| Agent | Input given | Output produced | Marker |
|---|---|---|---|
| 1 Rule Extractor | Books OpenAPI JSON | `[EXTRACTED RULES]` sections A–E; correctly separated *documented* vs *inferred* behavior; flagged create=200-not-201 as FINDING | `SMOKE: agent-1 OK` |
| 2 Test Case Generator | `[EXTRACTED RULES]` from agent 1 | `[GENERATED TEST CASES]` — 18 rows, all 6 required categories, FINDING tags, marked unverified expectations as "unverified" instead of inventing certainty | `SMOKE: agent-2 OK` |
| 3 Automation Script Agent | `[GENERATED TEST CASES]` from agent 2 | `[PLAYWRIGHT SCRIPTS]` — package.json + config + helpers + spec file, 1:1 `TC-NNN` test titles, NOTES section for the unverified 401 | `SMOKE: agent-3 OK` |
| 4 Coverage Evaluator | rules + test cases | `[COVERAGE REPORT]` — exact format, weighted formula applied (89%), 14 gap rows each naming method/path/input/expected status, Risk: Medium | `SMOKE: agent-4 OK` |
| 5 Feedback Loop | `[COVERAGE REPORT]` from agent 4 | 14 new TCs closing G1–G14, gap ids tagged per row, gap-closing script file, `[FINAL COVERAGE SUMMARY]` with honest Remaining Risks | `SMOKE: agent-5 OK` |

## 2. Refusal contracts (agents must stop without input)

Each agent was invoked with **no input document**:

| Agent | Refusal clause | Reply | Verdict |
|---|---|---|---|
| 1 | "If no spec is provided, stop and ask…" | "Please paste your API spec, Swagger JSON, or list of endpoints to begin." | PASS |
| 2 | "If it is not provided, stop and reply…" | "I need the [EXTRACTED RULES] block — run Agent 1 first or paste your API spec." | PASS |
| 3 | "If it is not provided, stop and reply…" | "I need the [GENERATED TEST CASES] block — run Agent 2 first." | PASS |
| 4 | "If either is missing, stop and reply…" | "I need both [EXTRACTED RULES] and [GENERATED TEST CASES] — run Agent 1 and Agent 2 first." | PASS |
| 5 | "If it is not provided, stop and reply…" | "I need the [COVERAGE REPORT] block — run Agent 4 first." | PASS |

**REFUSAL CHECK: 5/5 PASS**

## 3. Playwright suite executed against the live API

```
examples/playwright-suite/    90 tests / 9 files / helpers
target: https://ecommerce-api.fastapicloud.dev
```

Run history (kept honest — the first run was NOT green):

| Run | Result | What it found |
|---|---|---|
| 1st | **81 passed, 9 failed (34.7s)** | 3 real bugs — all in the harness, none in the API expectations: |
| ↳ fixes | `expect422` used `toContain` (exact match) against `["body.name",…]` looking for `"body"` → substring match · `user_id=999999` collided with test data our own curl verification had created on the shared demo → switched to `987654321` · Playwright has **no `request.options()`** → `request.fetch({method:'OPTIONS'})` · Playwright JSON-serializes string `data`, defeating the malformed-JSON test → raw `Buffer` |
| 2nd (`--last-failed`) | **9 passed (3.0s)** | all fixes effective |
| **3rd (full clean run)** | **90 passed (23.9s)** | **green** |

```bash
cd examples/playwright-suite
npm i && npx playwright test        # -> 90 passed
```

## 4. opencode discovers the agents

Run from the repo root:

```
$ opencode agent list
...
automation-script-agent (all)
coverage-evaluator (all)
feedback-loop (all)
rule-extractor (all)
test-case-generator (all)      # 5/5 present, mode "all"

$ opencode debug config
"command": { "qa-pipeline": { "description": "Run the full 5-agent QA pipeline …",
             "template": "… $ARGUMENTS …" } }   # /qa-pipeline registered
```

> Agent/command files are read **at opencode startup** — restart opencode after editing them.

---

## What this does and does not prove

**Proven:** every prompt file executes standalone and produces its contracted labeled output; refusals fire without input; the pipeline's generated suite really passes 90/90 against a live API; opencode wires everything up.

**Not proven:** behavior on APIs with real authentication/5xx/latency variety (the demo is no-auth); resistance to adversarial specs; cross-LLM consistency (validated on the model powering this session — re-run the smoke tests on your target model before trusting it there).
