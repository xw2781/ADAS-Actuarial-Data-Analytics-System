import { inferSqlDialect } from "../../ai-assistant/skills.js?v=20260726a";
import { createEditorPage } from "../shared/editor_framework.js?v=20260818a";

/**
 * The plain code/text editor: the generic editor framework in its scripting
 * mode. Only what running Python means lives here - the local streaming
 * session, the ArcRho macro route, interrupt, and session restart. Chrome,
 * file lifecycle, panel, and the ArcBot contract come from the framework.
 *
 * Run acts on the selection when there is one, so a fragment can be tried
 * without splitting the file. A selection is a fragment rather than a macro
 * definition, so it always runs in the local session.
 */

const shared = window.ArcodeEditorShared;
const scriptingSessionId = shared.getOrCreateScriptingSessionId();

let page = null;

const TEXT_FILE_FILTERS = [
  { name: "Code and Text Files", extensions: ["py", "r", "sql", "js", "ts", "json", "md", "txt", "css", "html"] },
  { name: "All Files", extensions: ["*"] },
];

function isPythonFile() {
  return page?.language() === "python";
}

async function runPython(code) {
  const source = String(code || "").trim();
  if (!source) return;
  const started = performance.now();
  page.setRunning(true, "local");
  page.setOutput("");
  page.setRunInfo("Running");
  page.setStatus("Running...");
  let donePayload = null;

  try {
    const response = await shared.scriptingFetch("/scripting/run-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: source }),
    }, scriptingSessionId);

    if (!response.ok || !response.body || typeof response.body.getReader !== "function") {
      const fallback = await shared.scriptingFetch("/scripting/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: source }),
      }, scriptingSessionId).then((r) => r.json());
      if (fallback.output) page.setOutput(fallback.output, { append: true });
      if (fallback.error) page.setOutput(fallback.error, { append: true, error: true });
      donePayload = fallback;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";

    function consumeLine(line) {
      const payload = String(line || "").trim();
      if (!payload) return;
      let event = null;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.type === "stdout") page.setOutput(event.text || "", { append: true });
      if (event.type === "stderr") page.setOutput(event.text || "", { append: true, error: true });
      if (event.type === "done") donePayload = event;
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let splitAt = buffered.indexOf("\n");
      while (splitAt >= 0) {
        consumeLine(buffered.slice(0, splitAt));
        buffered = buffered.slice(splitAt + 1);
        splitAt = buffered.indexOf("\n");
      }
    }
    buffered += decoder.decode();
    buffered.split("\n").forEach(consumeLine);
  } catch (err) {
    donePayload = { success: false, error: String(err?.message || err) };
    page.setOutput(`Network error: ${String(err?.message || err)}`, { error: true });
  } finally {
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    page.setRunInfo(`${elapsed} ms`);
    page.setStatus(donePayload?.success === false ? "Error" : "Done");
    page.setRunning(false);
  }
}

async function runInArcRho(code) {
  const source = String(code || "");
  if (!source.trim()) return;
  const started = performance.now();
  page.setRunning(true, "arcrho");
  page.setOutput("");
  page.setRunInfo("Running in ArcRho");
  page.setStatus("Running in ArcRho...");
  let result = null;

  try {
    const response = await shared.scriptingFetch("/scripting/run-in-arcrho", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        filename: page.filename(),
        source_path: page.path || "",
      }),
    }, scriptingSessionId);
    result = await response.json().catch(() => ({}));
    const stdout = String(result?.stdout || "").trimEnd();
    const message = String(result?.message || result?.detail || "").trim();
    const traceback = String(result?.traceback || "").trim();
    const output = [stdout, message, result?.success ? "" : traceback].filter(Boolean).join("\n");
    if (!response.ok || !result?.success) {
      throw new Error(output || `Run in ArcRho failed (HTTP ${response.status}).`);
    }
    page.setOutput(output || "Macro completed in ArcRho.");
    page.setStatus(result.cancelled ? "Not applied" : (result.applied ? "Applied in ArcRho" : "Done in ArcRho"));
  } catch (err) {
    const message = String(err?.message || err || "Run in ArcRho failed.");
    result = { success: false, message };
    page.setOutput(message, { error: true });
    page.setStatus("Run in ArcRho failed");
  } finally {
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    page.setRunInfo(`${elapsed} ms`);
    page.setRunning(false);
  }
}

function isArcRhoMacroSource(code) {
  const source = String(code || "");
  return /^\s*#\s*<arcrho-macro>\s*$/im.test(source)
    || /^def[\t ]+run_macro[\t ]*\(/m.test(source);
}

async function restartSession() {
  try {
    await shared.scriptingFetch("/scripting/reset", { method: "POST" }, scriptingSessionId);
    page.setOutput("");
    page.setStatus("Session restarted");
  } catch {
    page.setStatus("Restart failed");
  }
}

async function interruptExecution() {
  try {
    await shared.scriptingFetch("/scripting/interrupt", { method: "POST" }, scriptingSessionId);
    page.setStatus("Interrupt sent");
  } catch {
    page.setStatus("Interrupt failed");
  }
}

page = createEditorPage({
  id: "python",
  tabType: "code-editor",
  pageType: "code-editor",
  defaultTitle: "Untitled",
  panelTitle: "Output",
  suggestedFileName: "script.py",
  fileFilters: TEXT_FILE_FILTERS,
  restart: {
    label: "Restart",
    title: "Restart the Python session",
    run: () => restartSession(),
  },
  canRun: () => isPythonFile(),
  stop: () => interruptExecution(),
  run: ({ code, selectionOnly }) => (
    !selectionOnly && isArcRhoMacroSource(code) ? runInArcRho(code) : runPython(code)
  ),
  // A `.sql` file opens in a SQL editor now, but one saved here under that
  // name still shows SQL, so ArcBot keeps the dialect the shared skill infers.
  assistantContext: (editorPage) => (
    editorPage.language() === "sql"
      ? { sqlDialect: inferSqlDialect({ pageType: "code-editor", path: editorPage.path }) }
      : {}
  ),
});

void page.boot();
