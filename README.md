# Multi-Agent QA Framework

A reusable 5-agent pipeline that **thinks, evaluates, and improves test coverage** — not just generates test cases.

```
API spec ──▶ [1] Rule Extractor ──▶ [2] Test Case Generator ──▶ [3] Automation Script Agent
                                                                      │
        [FINAL COVERAGE SUMMARY] ◀── [5] Feedback Loop ◀── [4] Coverage Evaluator
```

Each agent has a hard **input/output contract** (labeled blocks), so you can run the whole pipeline at once — or any single agent on its own.

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

---

## Worked example

`examples/prompt2production-ecommerce.md` — a condensed real run of all 5 agents against
[Prompt2Production](https://github.com/Madhusudan-1990/Prompt2Production)'s e-commerce API
(`https://ecommerce-api.fastapicloud.dev`), showing expected output shape for every labeled block,
including the coverage-gaps iteration.

## Repository layout

```
multi-agent-qa-framework/
├── README.md                     # this file
├── prompts/                      # portable, LLM-agnostic prompts (source of truth)
│   ├── MASTER_PROMPT.md          # all 5 agents in one paste-able prompt
│   └── agent-{1..5}-*.md         # one file per agent
├── .opencode/
│   ├── agent/*.md                # same prompts wrapped as opencode agents (@-invocable)
│   └── command/qa-pipeline.md    # /qa-pipeline = full run with $ARGUMENTS
└── examples/                     # golden worked example
```

> `prompts/` and `.opencode/agent/` contain the same instructions in two packaging formats.
> If you edit an agent, update **both** files (the opencode file adds YAML frontmatter:
> `description` + `mode: all`).

## Extending

- **Add a 6th agent:** copy an existing `prompts/agent-N-*.md` + `.opencode/agent/*.md` pair, define its input label, and add it to `MASTER_PROMPT.md` and `qa-pipeline.md` in sequence.
- **Change stack (JUnit/pytest/RestAssured):** edit only Agent 3's prompt — agents 1, 2, 4, 5 are stack-agnostic.
- **Stricter coverage gate:** change `above 90%` in Agent 5 (and the master prompt) to your target.
