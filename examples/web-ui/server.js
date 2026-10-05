#!/usr/bin/env node
"use strict";
/*
 * Multi-Agent QA Framework — web UI backend (zero npm dependencies).
 *
 * Serves the single-page UI and proxies agent runs to the SAME five agent
 * files that opencode loads from .opencode/agent/*.md — via
 * `opencode run --agent <id> --format json <input>` (stdout is JSONL; we
 * forward type:"text" parts as SSE chunks).
 *
 *   node examples/web-ui/server.js     →  http://127.0.0.1:3000
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_TIMEOUT_MS = 600_000; // one agent can legitimately take minutes on slow/queued models
const MAX_BODY = 4 * 1024 * 1024;

// Resolve the binary now so the UI works even if started from a shell
// whose PATH differs from your interactive one.
const OPENCODE = (() => {
  try { return execSync("command -v opencode", { encoding: "utf8" }).trim(); }
  catch { return process.env.OPENCODE_BIN || "/Users/" + process.env.USER + "/.opencode/bin/opencode"; }
})();

const AGENTS = [
  { id: "rule-extractor",        n: 1, title: "Rule Extractor",        needs: "API spec / endpoint list", gives: "[EXTRACTED RULES]" },
  { id: "test-case-generator",   n: 2, title: "Test Case Generator",   needs: "[EXTRACTED RULES]",        gives: "[GENERATED TEST CASES]" },
  { id: "automation-script-agent", n: 3, title: "Automation Script Agent", needs: "[GENERATED TEST CASES]", gives: "[PLAYWRIGHT SCRIPTS]" },
  { id: "coverage-evaluator",    n: 4, title: "Coverage Evaluator",    needs: "rules + test cases",       gives: "[COVERAGE REPORT]" },
  { id: "feedback-loop",         n: 5, title: "Feedback Loop",         needs: "[COVERAGE REPORT]",        gives: "[FINAL COVERAGE SUMMARY]" },
];

let busy = false;       // one opencode run at a time (demo-friendly, token-safe)
let currentChild = null;
let cancelRequested = false;

/* ---------- helpers ---------- */

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/*
 * Run one agent. Streams `onText(delta)` for every assistant text part.
 * opencode --format json emits JSONL; text parts may be cumulative or
 * incremental per part id — we normalize to deltas either way.
 */
function runAgent(agentId, input, { onText, onRaw }, model) {
  return new Promise((resolve, reject) => {
    const args = ["run", "--agent", agentId, "--format", "json"];
    if (model) args.push("-m", String(model));
    // Never spawn with an empty message — opencode rejects it outright
    // ("You must provide a message or a command"). A neutral placeholder keeps
    // the agent's own refusal contract in charge of empty-input demos.
    const msg = input && input.trim() ? input : "(no input provided — respond strictly per your input contract)";
    args.push(msg);
    const child = spawn(OPENCODE, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    currentChild = child;
    const partLen = new Map();          // part id -> last text length seen
    let buf = "";
    let err = "";
    let tokens = null;
    let lastErrorEvent = "";
    let lastReason = "";
    let acc = "";                       // full text this run produced

    const killTimer = setTimeout(() => {
      console.log(`[agent] ${agentId} TIMEOUT after ${AGENT_TIMEOUT_MS / 1000}s — killing`);
      child.kill("SIGTERM");
      lastErrorEvent = `agent timed out after ${AGENT_TIMEOUT_MS / 1000}s`;
    }, AGENT_TIMEOUT_MS);
    const t0 = Date.now();
    let gotBytes = false;
    const typeCounts = Object.create(null);
    console.log(`[agent] ${agentId} spawned pid=${child.pid}`);

    const handleLine = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { onRaw(line); return; }
      typeCounts[ev.type || "?"] = (typeCounts[ev.type || "?"] || 0) + 1;

      if (ev.type === "text" && ev.part && typeof ev.part.text === "string") {
        const id = ev.part.id || "?";
        const full = ev.part.text;
        const prev = partLen.get(id);
        partLen.set(id, full.length);
        let delta = null;
        if (prev == null) delta = full;                    // first sight of this part
        else if (full.length > prev) delta = full.slice(prev);  // cumulative → suffix
        if (delta) { acc += delta; onText(delta); }        // else duplicate, drop
      } else if (ev.type === "error" || (ev.part && ev.part.type === "error")) {
        lastErrorEvent = JSON.stringify(ev).slice(0, 2000);
      } else if (ev.type === "step_finish" && ev.part) {
        if (ev.part.tokens) tokens = ev.part.tokens;
        if (ev.part.reason) lastReason = ev.part.reason;
      }
    };

    child.stdout.on("data", (d) => {
      if (!gotBytes) { gotBytes = true; console.log(`[agent] ${agentId} first stdout byte after ${Date.now() - t0}ms`); }
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });

    child.stderr.on("data", (d) => { err += d.toString(); });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      currentChild = null;
      if (buf.trim()) handleLine(buf.trim());   // flush a trailing line without \n
      console.log(`[agent] ${agentId} exited code=${code} signal=${signal} after ${Date.now() - t0}ms reason=${lastReason || "?"} chars=${acc.length} types=${JSON.stringify(typeCounts)}`);
      if (cancelRequested) { cancelRequested = false; resolve({ cancelled: true, tokens, text: acc }); return; }
      if (code === 0) { resolve({ tokens, text: acc }); return; }
      reject(new Error(lastErrorEvent || err.trim().slice(-2000) || `opencode exited with code ${code}`));
    });

    child.on("error", (e) => { clearTimeout(killTimer); currentChild = null; reject(e); });
  });
}

/* One run, with a single automatic retry if the model exited cleanly but
 * produced no text (observed on slow/free-tier models: exit 0, tools only). */
async function runAgentChecked(agentId, input, sink, model) {
  let r = await runAgent(agentId, input, sink, model);
  if (!r.cancelled && !(r.text || "").trim()) {
    console.log(`[agent] ${agentId} produced NO text — retrying once`);
    r = await runAgent(agentId, input, sink, model);
  }
  return r;
}

/* ---------- request handling ---------- */

function sseHead(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

/* Keep-alive pings while an agent runs (some clients/proxies drop idle
 * streams) + close diagnostics: we need to know WHICH side hung up. */
function startHeartbeat(res, label) {
  const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 10_000);
  const onClose = (hadError) => console.log(`[sse] ${label} connection closed (hadError=${hadError})`);
  res.on("close", onClose);
  return () => { clearInterval(hb); res.off("close", onClose); };
}

async function handleRun(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || "{}"); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e) })); return; }
  const { agent, input = "", model } = body;
  if (!AGENTS.some((a) => a.id === agent)) { res.writeHead(404); res.end(JSON.stringify({ error: "unknown agent" })); return; }
  if (busy) { res.writeHead(409); res.end(JSON.stringify({ error: "another run is in progress" })); return; }

  busy = true;
  sseHead(res);
  const stopHb = startHeartbeat(res, `run ${agent}`);
  res.on("close", () => { if (currentChild) { console.log(`[sse] run ${agent}: client gone — killing pid ${currentChild.pid}`); cancelRequested = true; currentChild.kill("SIGTERM"); } });
  const t0 = Date.now();
  send(res, "meta", { agent });
  try {
    const r = await runAgentChecked(agent, input, {
      onText: (text) => send(res, "chunk", { text }),
      onRaw: (line) => send(res, "raw", { line }),
    }, model);
    if (r.cancelled) send(res, "cancelled", {});
    else if (!(r.text || "").trim()) {
      send(res, "error", { message: `${agent} produced no output — the model returned an empty response even after one retry. Try again, or pass "model" to use a different one.` });
    } else send(res, "done", { elapsedMs: Date.now() - t0, tokens: r.tokens });
  } catch (e) {
    send(res, "error", { message: String((e && e.message) || e) });
  } finally {
    busy = false;
    stopHb();
    res.end();
  }
}

/* Full pipeline: 1 → 2 → 3 → 4 → 5, each stage's output chained as the next
 * input (stage 4 receives rules + cases together, per its contract). */
async function handlePipeline(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || "{}"); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e) })); return; }
  const input = String(body.input || "");
  const model = body.model;
  if (!input.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: "empty input" })); return; }
  if (busy) { res.writeHead(409); res.end(JSON.stringify({ error: "another run is in progress" })); return; }

  busy = true;
  sseHead(res);
  const stopHb = startHeartbeat(res, "pipeline");
  res.on("close", () => { if (currentChild) { console.log(`[sse] pipeline: client gone — killing pid ${currentChild.pid}`); cancelRequested = true; currentChild.kill("SIGTERM"); } });
  const t0 = Date.now();
  const outputs = [];              // 0-based: outputs[0] = rules, [1] = cases, ...

  const nextInputFor = (stageIdx) => {          // stageIdx: 0-based index of the stage ABOUT to run
    if (stageIdx === 3) return `${outputs[0]}\n\n${outputs[1]}`;   // coverage-evaluator needs both
    return outputs[stageIdx - 1];
  };

  try {
    for (let i = 0; i < AGENTS.length; i++) {
      const a = AGENTS[i];
      const stageInput = i === 0 ? input : nextInputFor(i);
      const s0 = Date.now();
      send(res, "stage", { index: i, agent: a.id, title: a.title, input: stageInput });

      const r = await runAgentChecked(a.id, stageInput, {
        onText: (text) => send(res, "chunk", { index: i, text }),
        onRaw: (line) => send(res, "raw", { index: i, line }),
      }, model);
      if (r.cancelled) { send(res, "cancelled", { index: i }); busy = false; stopHb(); res.end(); return; }
      if (!(r.text || "").trim()) {
        // Never chain an empty block — that is what used to surface as the
        // downstream "You must provide a message or a command" error.
        send(res, "error", { index: i, message: `Stage ${i + 1} (${a.title}) produced no output — the model returned an empty response even after one retry. Try again, or pass "model" to use a faster one.` });
        return;
      }
      outputs[i] = r.text;
      try { fs.writeFileSync(`/tmp/qa-ui-stage-${i + 1}.txt`, r.text); } catch {}
      send(res, "stage_done", { index: i, elapsedMs: Date.now() - s0, tokens: r.tokens });
    }
    send(res, "done", { elapsedMs: Date.now() - t0 });
  } catch (e) {
    send(res, "error", { message: String((e && e.message) || e) });
  } finally {
    busy = false;
    stopHb();
    res.end();
  }
}

function handleCancel(_req, res) {
  if (currentChild) { cancelRequested = true; currentChild.kill("SIGTERM"); res.writeHead(200); res.end(JSON.stringify({ ok: true })); }
  else { res.writeHead(409); res.end(JSON.stringify({ error: "nothing running" })); }
}

function serveStatic(req, res) {
  const url = req.url.split("?")[0];
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    return;
  }
  if (url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, agents: AGENTS.length })); return; }
  if (url === "/api/agents") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(AGENTS)); return; }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/run") return await handleRun(req, res);
    if (req.method === "POST" && req.url === "/api/pipeline") return await handlePipeline(req, res);
    if (req.method === "POST" && req.url === "/api/cancel") return handleCancel(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Multi-Agent QA UI   →  http://${HOST}:${PORT}`);
  console.log(`repo: ${REPO_ROOT}`);
  console.log(`opencode: ${OPENCODE}`);
});
