# Multi-Agent QA Framework

A reusable 5-agent pipeline that **thinks, evaluates, and improves test coverage** — not just generates test cases.

```
API spec ──▶ [1] Rule Extractor ──▶ [2] Test Case Generator ──▶ [3] Automation Script Agent
                                                                      │
        [FINAL COVERAGE SUMMARY] ◀── [5] Feedback Loop ◀── [4] Coverage Evaluator
```

Each agent has a hard **input/output contract** (labeled blocks), so you can run the whole pipeline at once — or any single agent on its own.

**Universal by design:** any application domain (web, mobile backend, IoT, payments, internal services), any HTTP style (REST / GraphQL-over-HTTP / SOAP / webhooks), spec as Swagger/OpenAPI, Postman/HAR, GraphQL SDL, gRPC `.proto`, README, endpoint list or base URL. The automation target defaults to Playwright/JS and swaps to JUnit, pytest, Karate, Cypress, k6, … just by naming it.

## The 5 agents

| # | Agent | Input | Output | Prompt file | opencode agent |
|---|-------|-------|--------|-------------|----------------|
| 1 | Rule Extractor | API spec (Swagger/README/URL) | `[EXTRACTED RULES]` | `prompts/agent-1-rule-extractor.md` | `.opencode/agent/rule-extractor.md` |
| 2 | Test Case Generator | `[EXTRACTED RULES]` | `[GENERATED TEST CASES]` | `prompts/agent-2-test-case-generator.md` | `.opencode/agent/test-case-generator.md` |
| 3 | Automation Script Agent | `[GENERATED TEST CASES]` | `[PLAYWRIGHT SCRIPTS]` | `prompts/agent-3-automation-script-agent.md` | `.opencode/agent/automation-script-agent.md` |
| 4 | Coverage Evaluator | `[EXTRACTED RULES]` + `[GENERATED TEST CASES]` | `[COVERAGE REPORT]` | `prompts/agent-4-coverage-evaluator.md` | `.opencode/agent/coverage-evaluator.md` |
| 5 | Feedback Loop | `[COVERAGE REPORT]` | `[FINAL COVERAGE SUMMARY]` | `prompts/agent-5-feedback-loop.md` | `.opencode/agent/feedback-loop.md` |

---

## How to use

### Option A — Full pipeline in one shot (any LLM)

Paste **`prompts/MASTER_PROMPT.md`** as your prompt in ChatGPT / Claude / opencode, then provide the API spec when asked. All 5 agents run in sequence automatically.

### Option B — Reuse agents individually (any LLM)

Paste **one** agent file from `prompts/` as your prompt, then provide its required input:

| You have | Paste this prompt | Then provide |
|---|---|---|
| An API spec | `agent-1-rule-extractor.md` | the spec (or a base URL) |
| `[EXTRACTED RULES]` | `agent-2-test-case-generator.md` | the rules block |
| `[GENERATED TEST CASES]` | `agent-3-automation-script-agent.md` | the test-case block |
| rules + test cases | `agent-4-coverage-evaluator.md` | both blocks |
| `[COVERAGE REPORT]` | `agent-5-feedback-loop.md` | the report block |

Chaining example — run only coverage, then only gap-closing:

```
You:  <paste agent-4-coverage-evaluator.md>
You:  [EXTRACTED RULES] ... <paste block from agent 1>
      [GENERATED TEST CASES] ... <paste block from agent 2>
AI:   [COVERAGE REPORT] ...
You:  <paste agent-5-feedback-loop.md>
You:  [COVERAGE REPORT] ... <paste block above>
AI:   new TCs + scripts + [FINAL COVERAGE SUMMARY]
```

Rules that make reuse reliable:
- Each agent refuses to run without its required input and tells you what's missing.
- Outputs are **labeled blocks** — always paste the whole block; downstream agents never see the original spec or earlier conversation.
- Never edit a labeled block before passing it on (renumbering TCs breaks Agent 3/4 traceability).

### Option C — Inside opencode (this repo as a project)

Open this repository as your opencode project and the agents are available immediately:

- **Run the whole pipeline:** `/qa-pipeline <paste spec or base URL>` (or `/qa-pipeline` alone and paste when asked)
- **Run one agent:** select it as your chat agent, or dispatch it as a subagent — `rule-extractor`, `test-case-generator`, `automation-script-agent`, `coverage-evaluator`, `feedback-loop`
- **Chain manually:** run one agent, then start a new turn with the next agent and paste the labeled output

**Install globally** (available in every project):

```bash
mkdir -p ~/.config/opencode/agent ~/.config/opencode/command
cp .opencode/agent/*.md ~/.config/opencode/agent/
cp .opencode/command/qa-pipeline.md ~/.config/opencode/command/
```

Restart opencode after adding or editing agent/command files — config is loaded at startup, not hot-reloaded.

### Option D — Web UI (one HTML page, same agents)

```bash
node examples/web-ui/server.js      # zero npm dependencies; prints the URL
open http://127.0.0.1:3000
```

**Requirements:** `opencode` installed and authenticated (the server shells out to it);
run from anywhere — paths resolve relative to the repo.

How to use:
1. **Paste a spec** into the top box — OpenAPI/Swagger, Postman/HAR, GraphQL schema,
   gRPC `.proto`, endpoint list, README, or base URL — or click **load Books demo spec**.
2. **▶ Run full pipeline** — the five stage cards stream their labeled blocks in sequence;
   each output auto-fills the next stage's input (stage 4 receives rules + cases together,
   per its contract). Per-card: live elapsed timer, token count, copyable output.
3. **Run a single stage** with its **run ▶** button — clear an input first to see a live
   **contract refusal** (amber pill). **■ stop** kills the current run; refresh is safe.
4. **Faster model:** `POST /api/run` or `/api/pipeline` accept `{"model":"provider/model"}`
   — e.g. `curl -sN -X POST localhost:3000/api/pipeline -H 'Content-Type: application/json' -d '{"input":"<spec>","model":"<model>"}'`.
   A green **NN% coverage** badge appears after stage 5.

The server is a thin proxy: it spawns the *same* `.opencode/agent/*.md` files via
`opencode run --agent <id> --format json` and forwards the text parts as SSE —
no separate API key, no second copy of the prompts.

![web UI](examples/web-ui/demo-screenshot.png)

E2E checks (with the server running):
- `node examples/web-ui/e2e.mjs` — drives the **full pipeline** in headless Chromium,
  asserts 5/5 stages complete + coverage badge, saves the screenshot above (~15–30 min
  depending on model speed).
- `SCREENSHOT_ONLY=1 node examples/web-ui/e2e.mjs` — screenshot without running agents.

---

## Worked example

`examples/prompt2production-ecommerce.md` — a condensed real run of all 5 agents against
[Prompt2Production](https://github.com/Madhusudan-1990/Prompt2Production)'s e-commerce API
(`https://ecommerce-api.fastapicloud.dev`), showing expected output shape for every labeled block,
including the coverage-gaps iteration.

**`examples/playwright-suite/`** — the actual 90-test suite that run produced, executable:
`cd examples/playwright-suite && npm i && npx playwright test` → **90 passed**.

## Validation

Every agent file was smoke-tested standalone in a fresh context, its refusal contract verified,
the generated suite executed live, and opencode's discovery of the agents confirmed —
see **[VALIDATION.md](VALIDATION.md)** for the evidence (5/5 smoke, 5/5 refusals, 90/90 tests green).

## Repository layout

```
multi-agent-qa-framework/
├── README.md                     # this file
├── VALIDATION.md                 # evidence: 5/5 smoke, 5/5 refusals, 90/90 green, opencode load
├── prompts/                      # portable, LLM-agnostic prompts (source of truth)
│   ├── MASTER_PROMPT.md          # all 5 agents in one paste-able prompt
│   └── agent-{1..5}-*.md         # one file per agent
├── .opencode/
│   ├── agent/*.md                # same prompts wrapped as opencode agents (@-invocable)
│   └── command/qa-pipeline.md    # /qa-pipeline = full run with $ARGUMENTS
└── examples/
    ├── prompt2production-ecommerce.md   # golden worked example (5 labeled outputs)
    ├── playwright-suite/                # the real 90-test suite from that run
    └── web-ui/                          # HTML frontend over the same agents (SSE, no deps)
        ├── server.js                    # spawns `opencode run --agent …`, streams as SSE
        ├── index.html                   # single-page UI: pipeline + per-stage runs
        └── e2e.mjs                      # headless-browser full-pipeline check
```

> `prompts/` and `.opencode/agent/` contain the same instructions in two packaging formats.
> If you edit an agent, update **both** files (the opencode file adds YAML frontmatter:
> `description` + `mode: all`).

## Extending

- **Add a 6th agent:** copy an existing `prompts/agent-N-*.md` + `.opencode/agent/*.md` pair, define its input label, and add it to `MASTER_PROMPT.md` and `qa-pipeline.md` in sequence.
- **Change stack (JUnit/pytest/RestAssured):** edit only Agent 3's prompt — agents 1, 2, 4, 5 are stack-agnostic.
- **Stricter coverage gate:** change `above 90%` in Agent 5 (and the master prompt) to your target.
