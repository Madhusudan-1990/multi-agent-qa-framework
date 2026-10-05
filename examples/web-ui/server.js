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
 *
 * Env:
 *   PORT                      default 3000
 *   QA_UI_AGENT_TIMEOUT_MS    per-agent hard timeout (default 600000)
 *   QA_UI_LOG                 log file path (default /tmp/qa-ui.log)
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_TIMEOUT_MS = Number(process.env.QA_UI_AGENT_TIMEOUT_MS) || 600_000;
const MAX_BODY = 4 * 1024 * 1024;
const LOG_FILE = process.env.QA_UI_LOG || "/tmp/qa-ui.log";
const RUN_FILE = process.env.QA_UI_RUN_FILE || "/tmp/qa-ui-run.json";

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

let busy = false;                 // one pipeline/single run at a time
const activeChildren = new Set(); // parallel stages may hold >1 child

/* ---------- helpers ---------- */

function log(...args) {
  const line = args.join(" ");
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

function send(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}

function killActive() {
  let n = 0;
  for (const c of activeChildren) { c._cancelled = true; try { c.kill("SIGTERM"); } catch {} n++; }
  return n;
}

/* Run-state persistence: a browser refresh/disconnect must NOT lose the run —
 * every stage's input/output/pill is written here as it completes, and the UI
 * restores from GET /api/last-run on page load. */
function patchRun(mutator) {
  let r = null;
  try { r = JSON.parse(fs.readFileSync(RUN_FILE, "utf8")); } catch {}
  if (!r || !Array.isArray(r.stages)) {
    r = { kind: "run", stages: AGENTS.map(() => null), startedAt: new Date().toISOString(), status: "idle" };
  }
  try { mutator(r); } catch (e) { log(`[run] patch failed: ${e.message}`); }
  r.updatedAt = new Date().toISOString();
  try { fs.writeFileSync(RUN_FILE, JSON.stringify(r)); } catch {}
  return r;
}
function saveStageArtifact(i, text) {
  try { fs.writeFileSync(`/tmp/qa-ui-stage-${i + 1}.txt`, text); } catch {}
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
    activeChildren.add(child);
    const partLen = new Map();          // part id -> last text length seen
    let buf = "";
    let err = "";
    let tokens = null;
    let lastErrorEvent = "";
    let lastReason = "";
    let acc = "";                       // full text this run produced

    const killTimer = setTimeout(() => {
      log(`[agent] ${agentId} TIMEOUT after ${AGENT_TIMEOUT_MS / 1000}s — killing`);
      child.kill("SIGTERM");
      lastErrorEvent = `agent timed out after ${AGENT_TIMEOUT_MS / 1000}s`;
    }, AGENT_TIMEOUT_MS);
    const t0 = Date.now();
    let gotBytes = false;
    const typeCounts = Object.create(null);
    log(`[agent] ${agentId} spawned pid=${child.pid} model=${model || "default"}`);

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
        if (prev == null) delta = full;                         // first sight of this part
        else if (full.length > prev) delta = full.slice(prev);  // cumulative → suffix
        if (delta) { acc += delta; onText(delta); }             // else duplicate, drop
      } else if (ev.type === "error" || (ev.part && ev.part.type === "error")) {
        lastErrorEvent = JSON.stringify(ev).slice(0, 2000);
      } else if (ev.type === "step_finish" && ev.part) {
        if (ev.part.tokens) tokens = ev.part.tokens;
        if (ev.part.reason) lastReason = ev.part.reason;
      }
    };

    child.stdout.on("data", (d) => {
      if (!gotBytes) { gotBytes = true; log(`[agent] ${agentId} first stdout byte after ${Date.now() - t0}ms`); }
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
      activeChildren.delete(child);
      if (buf.trim()) handleLine(buf.trim());   // flush a trailing line without \n
      log(`[agent] ${agentId} exited code=${code} signal=${signal} after ${Date.now() - t0}ms reason=${lastReason || "?"} chars=${acc.length} types=${JSON.stringify(typeCounts)}`);
      if (child._cancelled) { resolve({ cancelled: true, tokens, text: acc }); return; }
      if (code === 0) { resolve({ tokens, text: acc }); return; }
      const e = new Error(lastErrorEvent || err.trim().slice(-2000) || `opencode exited with code ${code}`);
      e.hadText = acc.length > 0;
      reject(e);
    });

    child.on("error", (e) => { clearTimeout(killTimer); activeChildren.delete(child); e.hadText = false; reject(e); });
  });
}

/* One run, with a single automatic retry if the model exited cleanly but
 * produced no text (observed on slow/free-tier models: exit 0, tools only),
 * or if it failed BEFORE producing any text (transient free-tier 403s). */
async function runAgentChecked(agentId, input, sink, model) {
  let r;
  try {
    r = await runAgent(agentId, input, sink, model);
  } catch (e) {
    if (e.hadText || e.cancelled) throw e;
    log(`[agent] ${agentId} failed with no output — retrying once: ${String(e.message).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 3000));
    r = await runAgent(agentId, input, sink, model);
  }
  if (!r.cancelled && !(r.text || "").trim()) {
    log(`[agent] ${agentId} produced NO text — retrying once`);
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
  const onClose = (hadError) => log(`[sse] ${label} connection closed (hadError=${hadError})`);
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
  res.on("close", (hadError) => log(`[sse] run ${agent} client gone (hadError=${hadError}) — run continues server-side`));
  const t0 = Date.now();
  const idx = AGENTS.findIndex((a) => a.id === agent);
  patchRun((r) => {
    r.kind = "run"; r.agent = agent; r.model = model || null;
    r.startedAt = new Date().toISOString(); r.status = "running"; r.error = null;
    if (!r.stages[idx]) r.stages[idx] = {};
    Object.assign(r.stages[idx], { input, pill: "running" });
  });
  send(res, "meta", { agent, model: model || null });
  try {
    const r = await runAgentChecked(agent, input, {
      onText: (text) => send(res, "chunk", { text }),
      onRaw: (line) => send(res, "raw", { line }),
    }, model);
    if (r.cancelled) {
      patchRun((x) => { x.status = "cancelled"; if (x.stages[idx]) x.stages[idx].pill = "cancelled"; });
      send(res, "cancelled", {});
    } else if (!(r.text || "").trim()) {
      patchRun((x) => { x.status = "error"; x.error = "empty output"; if (x.stages[idx]) x.stages[idx].pill = "error"; });
      send(res, "error", { message: `${agent} produced no output — the model returned an empty response even after one retry. Try again, or pick another model.` });
    } else {
      const elapsedMs = Date.now() - t0;
      saveStageArtifact(idx, r.text);
      patchRun((x) => {
        x.status = "done";
        Object.assign(x.stages[idx] || (x.stages[idx] = {}), { input, output: r.text, elapsedMs, tokens: r.tokens, pill: "done" });
      });
      send(res, "done", { elapsedMs, tokens: r.tokens });
    }
  } catch (e) {
    patchRun((x) => { x.status = "error"; x.error = String((e && e.message) || e); if (x.stages[idx]) x.stages[idx].pill = "error"; });
    send(res, "error", { message: String((e && e.message) || e) });
  } finally {
    busy = false;
    stopHb();
    res.end();
  }
}

/* Full pipeline: 1 → 2 → (3 ∥ 4) → 5. Stage 3 only needs the cases and
 * stage 4 needs rules+cases, so after stage 2 they run IN PARALLEL —
 * measured worth ~2–9 min on slow models (stage 3 was the longest stage).
 * Chain inputs follow the labeled-block contract. */
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
  res.on("close", (hadError) => log(`[sse] pipeline client gone (hadError=${hadError}) — run continues server-side`));
  const t0 = Date.now();
  const outputs = [];              // 0-based: outputs[0] = rules, [1] = cases, ...
  patchRun((r) => {
    r.kind = "pipeline"; r.model = model || null;
    r.startedAt = new Date().toISOString(); r.status = "running"; r.error = null;
    r.stages = AGENTS.map(() => null);
    r.stages[0] = { input, pill: "running" };
  });

  const inputFor = (i) => (i === 0 ? input : i === 3 ? `${outputs[0]}\n\n${outputs[1]}` : outputs[i - 1]);

  const runStage = async (i) => {
    const a = AGENTS[i];
    const stageInput = inputFor(i);
    const s0 = Date.now();
    patchRun((r) => { r.stages[i] = { input: stageInput, pill: "running" }; });
    send(res, "stage", { index: i, agent: a.id, title: a.title, input: stageInput });
    const r = await runAgentChecked(a.id, stageInput, {
      onText: (text) => send(res, "chunk", { index: i, text }),
      onRaw: (line) => send(res, "raw", { index: i, line }),
    }, model);
    if (r.cancelled) return { i, cancelled: true };
    if (!(r.text || "").trim()) {
      // Never chain an empty block — that used to surface as the confusing
      // downstream "You must provide a message or a command" error.
      const err = new Error(`Stage ${i + 1} (${a.title}) produced no output — the model returned an empty response even after one retry. Try again, or pick another model.`);
      err.index = i;
      throw err;
    }
    outputs[i] = r.text;
    saveStageArtifact(i, r.text);
    patchRun((x) => {
      const s = x.stages[i] || (x.stages[i] = {});
      Object.assign(s, { input: stageInput, output: r.text, elapsedMs: Date.now() - s0, tokens: r.tokens, pill: "done" });
    });
    send(res, "stage_done", { index: i, elapsedMs: Date.now() - s0, tokens: r.tokens });
    return { i, cancelled: false };
  };

  try {
    let r = await runStage(0);
    if (r.cancelled) { patchRun((x) => { x.status = "cancelled"; }); send(res, "cancelled", { index: 0 }); return; }
    r = await runStage(1);
    if (r.cancelled) { patchRun((x) => { x.status = "cancelled"; }); send(res, "cancelled", { index: 1 }); return; }

    // parallel pair: automation scripts (needs cases) + coverage (needs rules+cases)
    const results = await Promise.allSettled([runStage(2), runStage(3)]);
    const failed = results.find((x) => x.status === "rejected");
    const cancelled = results.find((x) => x.status === "fulfilled" && x.value && x.value.cancelled);
    if (failed) throw failed.reason;
    if (cancelled) { patchRun((x) => { x.status = "cancelled"; }); send(res, "cancelled", { index: cancelled.value.i }); return; }

    r = await runStage(4);
    if (r.cancelled) { patchRun((x) => { x.status = "cancelled"; }); send(res, "cancelled", { index: 4 }); return; }

    patchRun((x) => { x.status = "done"; x.elapsedMs = Date.now() - t0; });
    send(res, "done", { elapsedMs: Date.now() - t0 });
  } catch (e) {
    patchRun((x) => {
      x.status = "error";
      x.error = String((e && e.message) || e);
      if (e && e.index != null && x.stages[e.index]) x.stages[e.index].pill = "error";
    });
    send(res, "error", { ...(e && e.index != null ? { index: e.index } : {}), message: String((e && e.message) || e) });
  } finally {
    busy = false;
    stopHb();
    res.end();
  }
}

function handleCancel(_req, res) {
  const n = killActive();
  if (n) { log(`[cancel] killed ${n} child(ren)`); res.writeHead(200); res.end(JSON.stringify({ ok: true, killed: n })); }
  else { res.writeHead(409); res.end(JSON.stringify({ error: "nothing running" })); }
}

/* ---- diagnostics: server log tail + per-stage artifacts + model list ---- */

let modelsCache = { at: 0, list: [] };

function handleModels(_req, res) {
  if (Date.now() - modelsCache.at > 300_000) {
    try {
      const out = execSync("opencode models", { encoding: "utf8", timeout: 20_000 });
      const list = out.split("\n").map((l) => l.trim()).filter((l) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(l));
      if (list.length) modelsCache = { at: Date.now(), list };
    } catch (e) { log(`[models] refresh failed: ${e.message}`); }
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ models: modelsCache.list, cachedMs: Date.now() - modelsCache.at }));
}

function handleLogs(req, res) {
  const u = new URL(req.url, "http://x");
  const stage = u.searchParams.get("stage");
  res.writeHead(200, { "Content-Type": "application/json" });
  if (stage) {
    let content = "";
    try { content = fs.readFileSync(`/tmp/qa-ui-stage-${stage}.txt`, "utf8"); } catch {}
    return res.end(JSON.stringify({ stage: Number(stage), content }));
  }
  let logText = "";
  try {
    const buf = fs.readFileSync(LOG_FILE);
    logText = (buf.length > 200_000 ? buf.subarray(buf.length - 200_000) : buf).toString("utf8");
  } catch {}
  const stages = [];
  for (let n = 1; n <= 5; n++) {
    try { const st = fs.statSync(`/tmp/qa-ui-stage-${n}.txt`); stages.push({ n, size: st.size, mtime: st.mtimeMs }); }
    catch { stages.push({ n, size: 0, mtime: 0 }); }
  }
  res.end(JSON.stringify({ log: logText, stages, logFile: LOG_FILE }));
}

function serveStatic(req, res) {
  const url = req.url.split("?")[0];
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    return;
  }
  if (url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, agents: AGENTS.length, timeoutMs: AGENT_TIMEOUT_MS, logFile: LOG_FILE })); return; }
  if (url === "/api/agents") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(AGENTS)); return; }
  if (url === "/api/models") return handleModels(req, res);
  if (url === "/api/logs") return handleLogs(req, res);
  if (url === "/api/status") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ busy, activeChildren: activeChildren.size })); return; }
  if (url === "/api/last-run") {
    let run = null;
    try { run = JSON.parse(fs.readFileSync(RUN_FILE, "utf8")); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ run }));
    return;
  }
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
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
});

server.listen(PORT, HOST, () => {
  log(`Multi-Agent QA UI   →  http://${HOST}:${PORT}`);
  log(`repo: ${REPO_ROOT}`);
  log(`opencode: ${OPENCODE}`);
  log(`agent timeout: ${AGENT_TIMEOUT_MS / 1000}s   log: ${LOG_FILE}`);
});
