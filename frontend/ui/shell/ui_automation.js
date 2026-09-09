import { shell } from "./shell_context.js?v=20260510a";
import {
  captureActiveDfmContextForMacro,
  reviewAndApplyCapturedMacroResult,
} from "../macro/macro_window.js?v=20260908b";
import { createReviewTableDialog } from "../shared/components/review_table/review_table.js?v=20260828f";

const API_BASE = window.location.origin;
const POLL_CLIENT_ID = `shell_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const RESULT_MESSAGE_TYPE = "arcrho:automation-command-result";
const TASK_DESIGNER_COMMAND_MESSAGE = "arcrho:task-designer-automation-command";
const TASK_DESIGNER_RESULT_MESSAGE = "arcrho:task-designer-automation-result";

let automationStarted = false;
let automationStopped = false;
let messageBoxPromise = null;
const progressWindows = new Map();
const dismissedProgressWindows = new Set();
// The size the progress window was last pulled to by its corner grip, so a
// later run opens at the size the user chose instead of the default again.
let progressWindowSize = null;
const reviewTableDialogs = new Map();
// dialogId -> Project Instance tab hosting that review table as a nested
// window. Status/close commands must reach the owning tab even after the user
// switches shell tabs, so the tab reference is pinned at open time.
const reviewTableHostTabs = new Map();

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function installAutomationStyles() {
  if (document.getElementById("arcrho-ui-automation-style")) return;
  const style = document.createElement("style");
  style.id = "arcrho-ui-automation-style";
  style.textContent = `
    .uiAutomationOverlay {
      position: fixed;
      inset: 0;
      z-index: 20000;
      display: none;
      background: rgba(15, 23, 42, 0.22);
    }
    .uiAutomationOverlay.open { display: block; }
    .uiAutomationOverlay.floating {
      background: transparent;
      pointer-events: none;
    }
    .uiAutomationDialog {
      position: absolute;
      width: min(460px, calc(100vw - 40px));
      max-height: calc(100vh - 48px);
      background: #ffffff;
      border: 1px solid #cfd7e3;
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.22);
      color: #1f2937;
      overflow: hidden;
    }
    .uiAutomationOverlay.floating .uiAutomationDialog {
      /* This outranks any per-dialog width below, so floating windows such as
         the progress dialog are sized here. Wide enough for a reserving-class
         path plus a dataset name without truncating the label. */
      width: min(450px, calc(100vw - 40px));
      pointer-events: auto;
    }
    .uiAutomationDialogHeader {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #e3e8f0;
      cursor: move;
      user-select: none;
    }
    .uiAutomationDialogIcon {
      width: 22px;
      height: 22px;
      flex: 0 0 auto;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      background: #2563eb;
    }
    .uiAutomationDialogIcon.warning { background: #b45309; }
    .uiAutomationDialogIcon.error { background: #b91c1c; }
    .uiAutomationDialogIcon.question { background: #047857; }
    .uiAutomationDialogIcon svg {
      width: 14px;
      height: 14px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
    }
    .uiAutomationDialogTitle {
      min-width: 0;
      flex: 1 1 auto;
      font-size: 15px;
      font-weight: 650;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .uiAutomationDialogClose {
      width: 32px;
      height: 32px;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #64748b;
      font: inherit;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .uiAutomationDialogClose svg {
      width: 22px;
      height: 22px;
      display: block;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
    }
    .uiAutomationDialogClose:hover {
      background: #eef2f7;
      color: #1f2937;
    }
    .uiAutomationDialogBody {
      padding: 14px 16px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 13px;
      line-height: 1.45;
      color: #374151;
      max-height: min(360px, calc(100vh - 180px));
      overflow: auto;
    }
    .uiAutomationDialogLinks {
      /* Items the message names, each a link that opens it in the Project
         Instance page behind the box; the box stays open while they are
         inspected, so it is shown floating rather than modal. */
      margin: 0;
      padding: 0 16px 12px;
      list-style: none;
      max-height: min(220px, calc(100vh - 260px));
      overflow-y: auto;
      overflow-x: hidden;
      font-size: 13px;
      line-height: 1.45;
    }
    .uiAutomationDialogLinkKind {
      display: inline-block;
      min-width: 118px;
      padding-right: 8px;
      color: #64748b;
      white-space: nowrap;
    }
    .uiAutomationDialogLink {
      padding: 0;
      border: 0;
      background: transparent;
      color: #2b6df6;
      font: inherit;
      text-align: left;
      text-decoration: underline;
      text-underline-offset: 2px;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    .uiAutomationDialogLink:hover,
    .uiAutomationDialogLink:focus-visible {
      color: #1d4ed8;
      outline: none;
    }
    .uiAutomationDialogActions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px 14px;
      border-top: 1px solid #e3e8f0;
      background: #f8fafc;
    }
    .uiAutomationDialogBtn {
      min-width: 76px;
      height: 30px;
      border-radius: 6px;
      border: 1px solid #b9c4d4;
      background: #ffffff;
      color: #1f2937;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .uiAutomationDialogBtn.primary {
      border-color: #1d4ed8;
      background: #2563eb;
      color: #ffffff;
    }
    .uiAutomationOverlay.dragging,
    .uiAutomationOverlay.dragging * {
      cursor: move !important;
      user-select: none !important;
    }
    .uiAutomationOverlay.resizing,
    .uiAutomationOverlay.resizing * {
      cursor: nwse-resize !important;
      user-select: none !important;
    }
    .uiAutomationResizeHandle {
      /* Corner grip, the same affordance the review-table window carries, so
         both floating windows are resized the same way. */
      position: absolute;
      right: 0;
      bottom: 0;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
      touch-action: none;
    }
    .uiAutomationResizeHandle::after {
      content: "";
      position: absolute;
      right: 5px;
      bottom: 5px;
      width: 6px;
      height: 6px;
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      border-bottom-right-radius: 3px;
      opacity: 0.3;
    }
    .uiAutomationResizeHandle:hover::after {
      opacity: 0.55;
    }
    .uiAutomationProgressDialog {
      /* Width comes from the floating-overlay rule above, which outranks any
         width set here; once the corner grip is dragged an inline width and
         height outrank both. */
      height: 232px;
      min-width: 280px;
      min-height: 150px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px);
      display: flex;
      flex-direction: column;
    }
    .uiAutomationProgressDialog .uiAutomationDialogHeader {
      flex: 0 0 auto;
      padding: 10px 14px 9px;
    }
    .uiAutomationProgressDialog .uiAutomationDialogBody {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      height: auto;
      max-height: none;
      min-height: 58px;
      padding: 10px 14px 14px;
      overflow: hidden;
      /* The generic body keeps template whitespace for message text; here it
         would turn the newlines between rows into blank lines and push the
         Cancel row out of the fixed-height window. */
      white-space: normal;
    }
    .uiAutomationProgressActions {
      display: flex;
      flex: 0 0 auto;
      justify-content: flex-end;
      margin-top: 12px;
    }
    .uiAutomationProgressActions[hidden] {
      display: none;
    }
    .uiAutomationProgressCancel {
      height: 28px;
      min-width: 84px;
      border-radius: 4px;
    }
    .uiAutomationProgressCancel:hover:not([disabled]) {
      border-color: #93a4bd;
      background: #f8fafc;
    }
    .uiAutomationProgressCancel[disabled] {
      color: #64748b;
      background: #f1f5f9;
      cursor: default;
    }
    .uiAutomationProgressMeta {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      height: 16px;
      /* The label and bar float in the middle of whatever height the Cancel
         row leaves them, so the window reads the same with or without it. */
      margin-top: auto;
      margin-bottom: 4px;
      color: #64748b;
      font-size: 11px;
      line-height: 16px;
      overflow: hidden;
    }
    .uiAutomationProgressLabel {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .uiAutomationProgressCount {
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
      color: #334155;
      font-weight: 650;
    }
    .uiAutomationProgressTrack {
      position: relative;
      flex: 0 0 auto;
      height: 12px;
      margin-bottom: auto;
      overflow: hidden;
      border: 1px solid #bfdbfe;
      border-radius: 999px;
      background: #eff6ff;
    }
    .uiAutomationProgressFill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #2563eb, #2b6df6);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
      transition: width 180ms ease, min-width 180ms ease;
    }
    .uiAutomationProgressTrack.indeterminate .uiAutomationProgressFill {
      width: 32%;
      min-width: 48px;
      opacity: 0.72;
      animation: uiAutomationProgressSweep 1.35s ease-in-out infinite;
    }
    @keyframes uiAutomationProgressSweep {
      from { transform: translateX(-115%); }
      to { transform: translateX(315%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .uiAutomationProgressFill { transition: none; }
      .uiAutomationProgressTrack.indeterminate .uiAutomationProgressFill {
        width: 42%;
        animation: none;
        transform: none;
        opacity: 0.5;
      }
    }
  `;
  document.head.appendChild(style);
}

function getMessageBoxIcon(kind) {
  const normalized = toText(kind).toLowerCase();
  if (normalized === "warning") return { content: "!", cls: "warning" };
  if (normalized === "error") {
    return {
      content: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10"></path><path d="M17 7L7 17"></path></svg>',
      cls: "error",
    };
  }
  if (normalized === "question") return { content: "?", cls: "question" };
  return { content: "i", cls: "" };
}

function clampDialogPosition(dialog, left, top) {
  const margin = 12;
  const width = dialog.offsetWidth || 460;
  const height = dialog.offsetHeight || 180;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, Number(left) || margin), maxLeft),
    top: Math.min(Math.max(margin, Number(top) || margin), maxTop),
  };
}

// The corner grip only ever pulls the bottom-right edge, so the room left for
// the window is measured from the top-left corner it is anchored at. The floor
// comes from the dialog's own min-width/min-height, which keeps the rule about
// how small a window may become in the stylesheet beside the rest of its size.
function clampDialogSize(dialog, left, top, width, height) {
  const margin = 12;
  const computed = window.getComputedStyle(dialog);
  const minWidth = Math.max(240, Number.parseFloat(computed.minWidth) || 0);
  const minHeight = Math.max(120, Number.parseFloat(computed.minHeight) || 0);
  const maxWidth = Math.max(minWidth, window.innerWidth - Math.max(margin, left) - margin);
  const maxHeight = Math.max(minHeight, window.innerHeight - Math.max(margin, top) - margin);
  return {
    width: Math.min(Math.max(Number(width) || minWidth, minWidth), maxWidth),
    height: Math.min(Math.max(Number(height) || minHeight, minHeight), maxHeight),
  };
}

// Away from the grip the window is free to slide back towards the top-left
// corner, so the room it has is the whole app window less a margin on each
// side rather than whatever is left of the app window to the right of it.
// Measuring it this way keeps a narrower app window from shaving the window
// down when moving it would have been enough.
function clampDialogSizeToAppWindow(dialog, width, height) {
  const margin = 12;
  const computed = window.getComputedStyle(dialog);
  const minWidth = Math.max(240, Number.parseFloat(computed.minWidth) || 0);
  const minHeight = Math.max(120, Number.parseFloat(computed.minHeight) || 0);
  const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
  const maxHeight = Math.max(minHeight, window.innerHeight - margin * 2);
  return {
    width: Math.min(Math.max(Number(width) || minWidth, minWidth), maxWidth),
    height: Math.min(Math.max(Number(height) || minHeight, minHeight), maxHeight),
  };
}

// Adds the bottom-right grip and the pointer handling behind it. Like the
// header drag above, the grip captures the pointer so a fast pull cannot
// outrun hit-testing and drop the gesture (ArcRho UI rule L16).
function enableDialogResize(overlay, dialog, onSizeChange) {
  const handle = document.createElement("div");
  handle.className = "uiAutomationResizeHandle";
  handle.setAttribute("aria-hidden", "true");
  dialog.appendChild(handle);
  let resize = null;
  // The size the window is meant to hold, kept apart from the size it happens
  // to be drawn at. Only the grip changes it. An app window too small to hold
  // it trims what is drawn and leaves this figure alone, so the window comes
  // back to its own size the moment the room returns instead of keeping every
  // trim the app window ever forced on it.
  const opened = dialog.getBoundingClientRect();
  let wanted = opened.width && opened.height
    ? { width: opened.width, height: opened.height }
    : null;

  const draw = (width, height, anchored) => {
    const rect = dialog.getBoundingClientRect();
    const size = anchored
      ? clampDialogSize(dialog, rect.left, rect.top, width, height)
      : clampDialogSizeToAppWindow(dialog, width, height);
    dialog.style.width = `${Math.round(size.width)}px`;
    dialog.style.height = `${Math.round(size.height)}px`;
    const placed = clampDialogPosition(dialog, rect.left, rect.top);
    dialog.style.left = `${placed.left}px`;
    dialog.style.top = `${placed.top}px`;
    return size;
  };
  // Sets the size the window is meant to hold, which is how a reopened window
  // is put back to the size the last one was left at.
  const applySize = (width, height) => {
    const next = { width: Number(width) || 0, height: Number(height) || 0 };
    const size = draw(next.width, next.height, false);
    wanted = next.width > 0 && next.height > 0 ? next : size;
    return size;
  };
  // A pull holds the top-left corner still, so it is measured from there and
  // stops at the edge of the app window. What it lands on becomes the size the
  // window is meant to hold from then on.
  const onPointerMove = (event) => {
    if (!resize || event.pointerId !== resize.pointerId) return;
    event.preventDefault();
    wanted = draw(
      resize.width + event.clientX - resize.x,
      resize.height + event.clientY - resize.y,
      true,
    );
  };
  const stopResize = (event) => {
    if (!resize) return;
    if (event && event.pointerId !== undefined && event.pointerId !== resize.pointerId) return;
    const { pointerId } = resize;
    resize = null;
    overlay.classList.remove("resizing");
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", stopResize);
    handle.removeEventListener("pointercancel", stopResize);
    handle.removeEventListener("lostpointercapture", stopResize);
    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {
      /* the pointer is already gone; nothing to release */
    }
    const rect = dialog.getBoundingClientRect();
    try {
      onSizeChange?.({ width: Math.round(rect.width), height: Math.round(rect.height) });
    } catch {
      /* remembering the size is a convenience; never let it break the drag */
    }
  };
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (resize) stopResize();
    const rect = dialog.getBoundingClientRect();
    resize = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
    };
    overlay.classList.add("resizing");
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", stopResize);
    handle.addEventListener("pointercancel", stopResize);
    handle.addEventListener("lostpointercapture", stopResize);
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is unavailable; the handle listeners still track the pull */
    }
    event.preventDefault();
    event.stopPropagation();
  };
  // Resizing the app window redraws this one at the size it is meant to hold,
  // never at the size it is currently shown at, so a narrower app window can
  // only ever borrow room from it and never take it for good.
  const onWindowResize = () => {
    if (!wanted) {
      const rect = dialog.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      wanted = { width: rect.width, height: rect.height };
    }
    draw(wanted.width, wanted.height, false);
  };

  handle.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onWindowResize);
  return {
    applySize,
    destroy() {
      stopResize();
      handle.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onWindowResize);
      handle.remove();
    },
  };
}

function positionDialogInCenter(dialog) {
  const rect = dialog.getBoundingClientRect();
  const left = Math.round((window.innerWidth - rect.width) / 2);
  const top = Math.round((window.innerHeight - rect.height) / 2);
  const next = clampDialogPosition(dialog, left, top);
  dialog.style.left = `${next.left}px`;
  dialog.style.top = `${next.top}px`;
}

function enableDialogDrag(overlay, dialog) {
  const header = dialog.querySelector(".uiAutomationDialogHeader");
  if (!header) return () => {};
  let drag = null;

  const applyPosition = (left, top) => {
    const next = clampDialogPosition(dialog, left, top);
    dialog.style.left = `${next.left}px`;
    dialog.style.top = `${next.top}px`;
  };
  // The move/up listeners live on the header and the header captures the
  // pointer, so a fast drag cannot outrun hit-testing and lose the gesture
  // (ArcRho UI rule L16).
  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    applyPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  };
  const stopDrag = (event) => {
    if (!drag) return;
    if (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    const { pointerId } = drag;
    drag = null;
    overlay.classList.remove("dragging");
    header.removeEventListener("pointermove", onPointerMove);
    header.removeEventListener("pointerup", stopDrag);
    header.removeEventListener("pointercancel", stopDrag);
    header.removeEventListener("lostpointercapture", stopDrag);
    try {
      if (header.hasPointerCapture?.(pointerId)) header.releasePointerCapture(pointerId);
    } catch {
      /* the pointer is already gone; nothing to release */
    }
  };
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (drag) stopDrag();
    const rect = dialog.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    overlay.classList.add("dragging");
    header.addEventListener("pointermove", onPointerMove);
    header.addEventListener("pointerup", stopDrag);
    header.addEventListener("pointercancel", stopDrag);
    header.addEventListener("lostpointercapture", stopDrag);
    try {
      header.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is unavailable; the header listeners still track the drag */
    }
    event.preventDefault();
  };
  const onResize = () => {
    const rect = dialog.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  };

  header.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onResize);
  return () => {
    stopDrag();
    header.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("resize", onResize);
  };
}

export function showAutomationMessageBox(args = {}) {
  if (messageBoxPromise) return messageBoxPromise;
  installAutomationStyles();
  const overlay = document.createElement("div");
  overlay.className = "uiAutomationOverlay host-nodrag";
  if (args.presentation === "floating") overlay.classList.add("floating");
  overlay.setAttribute("role", "presentation");
  const buttons = Array.isArray(args.buttons) && args.buttons.length
    ? args.buttons.map((item) => toText(item)).filter(Boolean).slice(0, 4)
    : ["OK"];
  const icon = getMessageBoxIcon(args.kind);
  overlay.innerHTML = `
    <section class="uiAutomationDialog" role="dialog" aria-modal="true" aria-labelledby="uiAutomationDialogTitle">
      <div class="uiAutomationDialogHeader">
        <span class="uiAutomationDialogIcon ${icon.cls}" aria-hidden="true">${icon.content}</span>
        <div class="uiAutomationDialogTitle" id="uiAutomationDialogTitle"></div>
      </div>
      <div class="uiAutomationDialogBody"></div>
      <div class="uiAutomationDialogActions"></div>
    </section>
  `;
  overlay.querySelector(".uiAutomationDialogTitle").textContent = toText(args.title) || "ArcRho";
  overlay.querySelector(".uiAutomationDialogBody").textContent = String(args.message || "");
  const links = Array.isArray(args.links) ? args.links.filter((item) => toText(item?.label)) : [];
  if (links.length) {
    const list = document.createElement("ul");
    list.className = "uiAutomationDialogLinks";
    for (const [index, item] of links.entries()) {
      const row = document.createElement("li");
      const kind = document.createElement("span");
      kind.className = "uiAutomationDialogLinkKind";
      kind.textContent = toText(item.kind);
      const link = document.createElement("button");
      link.type = "button";
      link.className = "uiAutomationDialogLink";
      link.textContent = toText(item.label);
      link.dataset.link = String(index);
      row.append(kind, link);
      list.appendChild(row);
    }
    overlay.querySelector(".uiAutomationDialogBody").after(list);
  }
  const actions = overlay.querySelector(".uiAutomationDialogActions");
  for (const [index, label] of buttons.entries()) {
    const button = document.createElement("button");
    button.className = `uiAutomationDialogBtn${index === 0 ? " primary" : ""}`;
    button.type = "button";
    button.textContent = label;
    button.dataset.button = label;
    actions.appendChild(button);
  }
  document.body.appendChild(overlay);
  overlay.classList.add("open");
  const dialog = overlay.querySelector(".uiAutomationDialog");
  positionDialogInCenter(dialog);
  const cleanupDrag = enableDialogDrag(overlay, dialog);

  messageBoxPromise = new Promise((resolve) => {
    let autoCloseTimer = 0;
    const cleanup = () => {
      if (autoCloseTimer) window.clearTimeout(autoCloseTimer);
      overlay.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey, true);
      cleanupDrag();
      overlay.remove();
      messageBoxPromise = null;
    };
    const finish = (button) => {
      cleanup();
      resolve({ button: button || buttons[0] || "OK" });
    };
    const onClick = (event) => {
      const button = event.target?.closest?.(".uiAutomationDialogBtn");
      if (button) {
        event.preventDefault();
        finish(toText(button.dataset.button));
        return;
      }
      const link = event.target?.closest?.(".uiAutomationDialogLink");
      if (link) {
        event.preventDefault();
        const item = links[Number(link.dataset.link)];
        void sendCommandToProjectInstance({ command: "projectInstance.openDataset", args: item?.args || {} });
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(buttons.includes("Cancel") ? "Cancel" : buttons[buttons.length - 1]);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        finish(buttons[0]);
      }
    };
    overlay.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    const autoCloseMs = Number(args.autoCloseMs || args.auto_close_ms || 0);
    if (Number.isFinite(autoCloseMs) && autoCloseMs > 0) {
      autoCloseTimer = window.setTimeout(() => finish(buttons[0] || "OK"), Math.max(250, autoCloseMs));
    }
    setTimeout(() => {
      try { overlay.querySelector(".uiAutomationDialogBtn.primary")?.focus(); } catch {}
    }, 0);
  });
  return messageBoxPromise;
}

function reviewTableIdFromArgs(args = {}) {
  return toText(args.dialogId || args.dialog_id || args.id);
}

function createReviewTableId() {
  return `review_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function openAutomationReviewTable(args = {}) {
  const existingPending = Array.from(reviewTableDialogs.values()).find((entry) => entry.status === "pending");
  if (existingPending) {
    throw new Error("Finish the open review table before opening another one.");
  }
  const dialogId = reviewTableIdFromArgs(args) || createReviewTableId();
  if (reviewTableDialogs.has(dialogId)) {
    throw new Error(`Review table already exists: ${dialogId}`);
  }
  const entry = { status: "pending", result: null, controller: null };
  entry.controller = createReviewTableDialog(args, {
    onComplete(result) {
      entry.status = "completed";
      entry.result = {
        accepted: !!result?.accepted,
        selectedRowIds: Array.isArray(result?.selectedRowIds) ? result.selectedRowIds : [],
        optionStates: result?.optionStates && typeof result.optionStates === "object"
          ? result.optionStates
          : {},
      };
    },
  });
  reviewTableDialogs.set(dialogId, entry);
  return { dialogId };
}

export function getAutomationReviewTableStatus(args = {}) {
  const dialogId = reviewTableIdFromArgs(args);
  if (!dialogId) throw new Error("Review table status requires dialogId.");
  const entry = reviewTableDialogs.get(dialogId);
  if (!entry) throw new Error(`Review table is not available: ${dialogId}`);
  if (entry.status === "pending") {
    return { dialogId, status: "pending", pending: true };
  }
  return {
    dialogId,
    status: "completed",
    pending: false,
    accepted: !!entry.result?.accepted,
    selectedRowIds: Array.isArray(entry.result?.selectedRowIds) ? [...entry.result.selectedRowIds] : [],
    optionStates: entry.result?.optionStates && typeof entry.result.optionStates === "object"
      ? { ...entry.result.optionStates }
      : {},
  };
}

export function closeAutomationReviewTable(args = {}) {
  const dialogId = reviewTableIdFromArgs(args);
  if (!dialogId) throw new Error("Closing a review table requires dialogId.");
  const entry = reviewTableDialogs.get(dialogId);
  if (!entry) return { dialogId, closed: false, cancelled: false };
  const cancelled = entry.status === "pending";
  if (cancelled) entry.controller?.close?.("automation");
  reviewTableDialogs.delete(dialogId);
  return { dialogId, closed: true, cancelled };
}

function reviewTableWantsProjectInstanceHost(args = {}) {
  return toText(args.host).toLowerCase().replace(/[\s_-]/g, "") === "projectinstance";
}

function isLiveShellTab(tab) {
  return !!tab && Array.isArray(shell.state?.tabs) && shell.state.tabs.includes(tab);
}

async function openReviewTableCommand(command) {
  const args = command.args || {};
  if (reviewTableWantsProjectInstanceHost(args)) {
    const tab = findActiveProjectInstanceTab();
    if (tab) {
      const outcome = await sendCommandToProjectInstance(command, {
        tab,
        messageType: "arcrho:automation-review-table-open",
      });
      if (outcome?.ok) {
        const dialogId = toText(outcome.result?.dialogId);
        if (dialogId) reviewTableHostTabs.set(dialogId, tab);
      }
      return outcome;
    }
    // No active Project Instance page to host the nested window: fall back to
    // the shell modal dialog so the caller's review still happens.
  }
  return { ok: true, result: openAutomationReviewTable(args) };
}

async function routeReviewTableFollowUp(command, isClose) {
  const args = command.args || {};
  const dialogId = reviewTableIdFromArgs(args);
  const hostTab = dialogId ? reviewTableHostTabs.get(dialogId) : null;
  if (!hostTab) {
    return {
      ok: true,
      result: isClose ? closeAutomationReviewTable(args) : getAutomationReviewTableStatus(args),
    };
  }
  if (!isLiveShellTab(hostTab) || !hostTab.iframe?.contentWindow) {
    // The hosting Project Instance tab was closed, so the review can never
    // finish: report a cancelled completion instead of an error so the caller
    // exits its poll loop cleanly.
    reviewTableHostTabs.delete(dialogId);
    return isClose
      ? { ok: true, result: { dialogId, closed: false, cancelled: false } }
      : { ok: true, result: { dialogId, status: "completed", pending: false, accepted: false, selectedRowIds: [], optionStates: {} } };
  }
  const outcome = await sendCommandToProjectInstance(command, {
    tab: hostTab,
    messageType: isClose ? "arcrho:automation-review-table-close" : "arcrho:automation-review-table-status",
  });
  if (isClose && outcome?.ok) reviewTableHostTabs.delete(dialogId);
  return outcome;
}

function progressIdFromArgs(args = {}) {
  return toText(args.progressId || args.progress_id || args.id) || "default";
}

function coerceProgressNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// The one place a progress readout is worded. A caller that measures in
// something other than whole items - bytes, above all - supplies its own value
// text and still gets the shared percentage, so no caller has to format a
// percent of its own.
export function composeProgressCountText(total, completed, providedCount = "") {
  const value = String(providedCount || "").trim();
  if (total <= 0) return value;
  const percent = Math.max(0, Math.min(100, (completed / total) * 100));
  return `${value || `${Math.min(completed, total)} / ${total}`} (${percent.toFixed(1)}%)`;
}

function applyProgressWindowState(entry, args = {}) {
  if (!entry?.overlay) return;
  const total = Math.max(0, coerceProgressNumber(args.total, entry.total || 0));
  const completed = Math.max(0, coerceProgressNumber(args.completed ?? args.value, entry.completed || 0));
  entry.total = total;
  entry.completed = completed;
  const percent = total > 0 ? Math.max(0, Math.min(100, (completed / total) * 100)) : 0;
  const label = toText(args.label) || entry.label || "Progress";
  entry.label = label;
  const countText = composeProgressCountText(total, completed, toText(args.countText || args.count_text));

  const titleEl = entry.overlay.querySelector(".uiAutomationDialogTitle");
  const labelEl = entry.overlay.querySelector(".uiAutomationProgressLabel");
  const countEl = entry.overlay.querySelector(".uiAutomationProgressCount");
  const trackEl = entry.overlay.querySelector(".uiAutomationProgressTrack");
  const fillEl = entry.overlay.querySelector(".uiAutomationProgressFill");
  if (titleEl && args.title !== undefined) titleEl.textContent = toText(args.title) || "ArcRho";
  if (labelEl) labelEl.textContent = label;
  if (countEl) countEl.textContent = countText;
  trackEl?.classList.toggle("indeterminate", total <= 0);
  if (fillEl) {
    if (total <= 0) {
      fillEl.style.removeProperty("width");
      fillEl.style.removeProperty("min-width");
    } else {
      fillEl.style.width = `${percent}%`;
      fillEl.style.minWidth = percent > 0 ? "3px" : "0";
    }
  }
  applyProgressCancelState(entry, args);
}

// A caller that can stop its job passes `cancellable` on open and on every
// update while stopping is still possible, then `false` once the job has gone
// past the point of no return; the button follows that flag. `onCancel` runs
// once, after which the button reads "Cancelling..." until the caller closes
// or re-enables it.
function applyProgressCancelState(entry, args = {}) {
  if (typeof args.onCancel === "function") entry.onCancel = args.onCancel;
  if (args.cancellable === undefined) return;
  const actionsEl = entry.overlay.querySelector(".uiAutomationProgressActions");
  const buttonEl = entry.overlay.querySelector(".uiAutomationProgressCancel");
  if (!actionsEl || !buttonEl) return;
  const cancellable = !!args.cancellable;
  if (cancellable && !entry.cancellable) {
    entry.cancelRequested = false;
    buttonEl.disabled = false;
    buttonEl.textContent = "Cancel";
  }
  entry.cancellable = cancellable;
  actionsEl.hidden = !cancellable;
}

function requestProgressCancel(entry) {
  if (!entry || !entry.cancellable || entry.cancelRequested) return;
  entry.cancelRequested = true;
  const buttonEl = entry.overlay?.querySelector(".uiAutomationProgressCancel");
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Cancelling...";
  }
  try {
    entry.onCancel?.();
  } catch (error) {
    console.warn("Progress cancel handler failed:", error);
  }
}

export function openAutomationProgress(args = {}) {
  installAutomationStyles();
  const progressId = progressIdFromArgs(args);
  dismissedProgressWindows.delete(progressId);
  const existing = progressWindows.get(progressId);
  if (existing?.overlay?.isConnected) {
    applyProgressWindowState(existing, args);
    return { progressId };
  }

  const overlay = document.createElement("div");
  overlay.className = "uiAutomationOverlay floating host-nodrag open";
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = `
    <section class="uiAutomationDialog uiAutomationProgressDialog" role="status" aria-live="polite">
      <div class="uiAutomationDialogHeader">
        <span class="uiAutomationDialogIcon" aria-hidden="true">i</span>
        <div class="uiAutomationDialogTitle"></div>
        <button class="uiAutomationDialogClose" type="button" aria-label="Close progress window" title="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12"></path>
            <path d="M18 6L6 18"></path>
          </svg>
        </button>
      </div>
      <div class="uiAutomationDialogBody">
        <div class="uiAutomationProgressMeta">
          <span class="uiAutomationProgressLabel"></span>
          <span class="uiAutomationProgressCount"></span>
        </div>
        <div class="uiAutomationProgressTrack" aria-hidden="true">
          <div class="uiAutomationProgressFill"></div>
        </div>
        <div class="uiAutomationProgressActions" hidden>
          <button class="uiAutomationDialogBtn uiAutomationProgressCancel" type="button">Cancel</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector(".uiAutomationDialog");
  const resizer = enableDialogResize(overlay, dialog, (size) => { progressWindowSize = size; });
  // A run that reopens the window - the next macro, or the next step of this
  // one - reuses whatever size the last one was pulled to, so the choice is
  // made once rather than at every open.
  if (progressWindowSize) resizer.applySize(progressWindowSize.width, progressWindowSize.height);
  const rect = dialog.getBoundingClientRect();
  const left = Math.round(window.innerWidth - rect.width - 28);
  const top = 72;
  const next = clampDialogPosition(dialog, left, top);
  dialog.style.left = `${next.left}px`;
  dialog.style.top = `${next.top}px`;
  const cleanupDrag = enableDialogDrag(overlay, dialog);
  const entry = {
    overlay, cleanupDrag, cleanupResize: resizer.destroy, total: 0, completed: 0, label: "",
    cancellable: false, cancelRequested: false, onCancel: null,
  };
  progressWindows.set(progressId, entry);
  const closeButton = overlay.querySelector(".uiAutomationDialogClose");
  closeButton?.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeAutomationProgress({ progressId, dismiss: true });
  });
  const cancelButton = overlay.querySelector(".uiAutomationProgressCancel");
  cancelButton?.addEventListener("pointerdown", (event) => event.stopPropagation());
  cancelButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestProgressCancel(entry);
  });
  applyProgressWindowState(entry, {
    title: "ArcRho Progress",
    label: "Starting...",
    detail: "",
    ...args,
  });
  return { progressId };
}

export function updateAutomationProgress(args = {}) {
  const progressId = progressIdFromArgs(args);
  const entry = progressWindows.get(progressId);
  if (!entry?.overlay?.isConnected && dismissedProgressWindows.has(progressId)) {
    return { progressId, dismissed: true };
  }
  if (!entry?.overlay?.isConnected) return openAutomationProgress(args);
  applyProgressWindowState(entry, args);
  return { progressId };
}

export function closeAutomationProgress(args = {}) {
  const progressId = progressIdFromArgs(args);
  const entry = progressWindows.get(progressId);
  if (args.dismiss || args.dismissed || args.userDismissed || args.user_dismissed) {
    dismissedProgressWindows.add(progressId);
  }
  if (!entry) return { progressId, closed: false };
  const remove = () => {
    entry.cleanupDrag?.();
    entry.cleanupResize?.();
    entry.overlay?.remove();
    progressWindows.delete(progressId);
  };
  const autoCloseMs = Number(args.autoCloseMs || args.auto_close_ms || 0);
  if (Number.isFinite(autoCloseMs) && autoCloseMs > 0) {
    window.setTimeout(remove, Math.max(250, autoCloseMs));
  } else {
    remove();
  }
  return { progressId, closed: true };
}

function findActiveProjectInstanceTab() {
  const active = shell.state?.tabs?.find?.((tab) => tab.id === shell.state.activeId);
  if (active?.type === "project_instance") return active;
  return null;
}

function getProjectInstanceAutomationMessageType(commandName) {
  if (commandName === "projectInstance.context" || commandName === "projectInstance.getContext") {
    return "arcrho:automation-project-instance-context";
  }
  if (commandName === "projectInstance.refreshDatasets" || commandName === "projectInstance.reloadDatasetTable") {
    return "arcrho:automation-project-instance-refresh-datasets";
  }
  if (commandName === "projectInstance.openDataset") return "arcrho:automation-open-dataset";
  if (
    commandName === "projectInstance.windowAction"
    || commandName === "projectInstance.windowProperties"
    || commandName === "projectInstance.activeWindow"
  ) {
    return "arcrho:automation-window-command";
  }
  return "";
}

// The submitter told the app server how long it is prepared to wait, and the
// server forwards that budget with the command. Honour it instead of applying a
// fixed wait: a reload that legitimately takes longer than a hard-coded ceiling
// would otherwise be reported as failed while it is still running and about to
// succeed. The margin leaves the submitter time to receive this reply rather
// than racing its own deadline and reporting a less specific error.
const AUTOMATION_REPLY_MARGIN_MS = 1500;
const AUTOMATION_FALLBACK_TIMEOUT_MS = 10000;

export function automationCommandTimeoutMs(command) {
  const budgetSec = Number(command?.timeout_sec ?? command?.timeoutSec);
  if (!Number.isFinite(budgetSec) || budgetSec <= 0) return AUTOMATION_FALLBACK_TIMEOUT_MS;
  return Math.max(1000, budgetSec * 1000 - AUTOMATION_REPLY_MARGIN_MS);
}

function sendCommandToProjectInstance(command, options = {}) {
  const tab = options.tab || findActiveProjectInstanceTab();
  if (!tab) {
    return Promise.resolve({ ok: false, error: "Activate a Project Instance page before running this UI command." });
  }
  shell.ensureIframe?.(tab);
  const iframe = tab.iframe;
  if (!iframe?.contentWindow) {
    return Promise.resolve({ ok: false, error: "The active Project Instance page is not ready." });
  }
  const messageType = toText(options.messageType)
    || getProjectInstanceAutomationMessageType(toText(command?.command));
  if (!messageType) {
    return Promise.resolve({ ok: false, error: `Unsupported Project Instance command: ${toText(command?.command)}` });
  }

  return new Promise((resolve) => {
    const requestId = `ui_auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(payload || { ok: false, error: "Project Instance command failed." });
    };
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const msg = event.data || {};
      if (msg.type !== RESULT_MESSAGE_TYPE || msg.requestId !== requestId) return;
      finish({ ok: !!msg.ok, result: msg.result || {}, error: toText(msg.error) });
    };
    window.addEventListener("message", onMessage);
    try {
      iframe.contentWindow.postMessage({
        type: messageType,
        requestId,
        args: command.args || {},
      }, "*");
    } catch (err) {
      finish({ ok: false, error: toText(err?.message) || "Failed to send Project Instance command." });
      return;
    }
    setTimeout(
      () => finish({ ok: false, error: "Timed out waiting for Project Instance." }),
      automationCommandTimeoutMs(command),
    );
  });
}

function waitForIframeReady(iframe, timeoutMs = 5000) {
  if (!iframe) return Promise.resolve(false);
  try {
    const ready = iframe.contentDocument?.readyState;
    if (ready === "interactive" || ready === "complete") return Promise.resolve(true);
  } catch {}
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      iframe.removeEventListener("load", onLoad);
      window.clearTimeout(timer);
      resolve(!!ok);
    };
    const onLoad = () => finish(true);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    iframe.addEventListener("load", onLoad, { once: true });
  });
}

async function sendCommandToTaskDesigner(command) {
  const args = command?.args || {};
  const name = toText(command?.command);
  let tab = shell.state.tabs.find((item) => item.type === "task_designer");
  if (!tab || name === "taskDesigner.open") {
    tab = shell.openTaskDesigner?.({
      title: args.title || "Task Designer",
      contextLabel: args.context || args.contextLabel || "Active DFM validation",
      macroId: args.macroId || args.macro_id || "",
      autoRun: false,
    }) || tab;
  }
  if (!tab) return { ok: false, error: "Could not open Task Designer." };
  shell.ensureIframe?.(tab);
  const iframe = tab.iframe;
  if (!iframe?.contentWindow) return { ok: false, error: "Task Designer page is not ready." };
  await waitForIframeReady(iframe);

  return new Promise((resolve) => {
    const requestId = `task_designer_auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(payload || { ok: false, error: "Task Designer command failed." });
    };
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const msg = event.data || {};
      if (msg.type !== TASK_DESIGNER_RESULT_MESSAGE || msg.requestId !== requestId) return;
      finish({ ok: !!msg.ok, result: msg.result || {}, error: toText(msg.error) });
    };
    window.addEventListener("message", onMessage);
    try {
      iframe.contentWindow.postMessage({
        type: TASK_DESIGNER_COMMAND_MESSAGE,
        requestId,
        command: name,
        args,
      }, "*");
    } catch (err) {
      finish({ ok: false, error: toText(err?.message) || "Failed to send Task Designer command." });
      return;
    }
    window.setTimeout(
      () => finish({ ok: false, error: "Timed out waiting for Task Designer." }),
      automationCommandTimeoutMs(command),
    );
  });
}

async function executeAutomationCommand(command) {
  const name = toText(command?.command);
  if (name === "ui.messageBox") {
    const result = await showAutomationMessageBox(command.args || {});
    return { ok: true, result };
  }
  if (name === "ui.reviewTableOpen") {
    return openReviewTableCommand(command);
  }
  if (name === "ui.reviewTableStatus") {
    return routeReviewTableFollowUp(command, false);
  }
  if (name === "ui.reviewTableClose") {
    return routeReviewTableFollowUp(command, true);
  }
  if (name === "ui.progressOpen") {
    return { ok: true, result: openAutomationProgress(command.args || {}) };
  }
  if (name === "ui.progressUpdate") {
    return { ok: true, result: updateAutomationProgress(command.args || {}) };
  }
  if (name === "ui.progressClose") {
    return { ok: true, result: closeAutomationProgress(command.args || {}) };
  }
  if (name === "macro.captureActiveDfmContext") {
    const result = await captureActiveDfmContextForMacro();
    return result?.ok
      ? { ok: true, result }
      : { ok: false, error: toText(result?.error) || "Could not capture the active DFM." };
  }
  if (name === "macro.reviewAndApplyResult") {
    const result = await reviewAndApplyCapturedMacroResult(command.args || {});
    return result?.ok
      ? { ok: true, result }
      : { ok: false, error: toText(result?.error) || "Could not apply the macro result." };
  }
  if (name.startsWith("taskDesigner.")) {
    return sendCommandToTaskDesigner(command);
  }
  if (name === "projectInstance.openDataset") {
    return sendCommandToProjectInstance(command);
  }
  if (
    name === "projectInstance.context"
    || name === "projectInstance.getContext"
    || name === "projectInstance.refreshDatasets"
    || name === "projectInstance.reloadDatasetTable"
    || name === "projectInstance.windowAction"
    || name === "projectInstance.windowProperties"
    || name === "projectInstance.activeWindow"
  ) {
    return sendCommandToProjectInstance(command);
  }
  return { ok: false, error: `Unsupported UI automation command: ${name}` };
}

async function completeCommand(commandId, payload) {
  try {
    await fetch(`${API_BASE}/ui_automation/commands/${encodeURIComponent(commandId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: !!payload?.ok,
        result: payload?.result || {},
        error: toText(payload?.error),
      }),
    });
  } catch (err) {
    shell.updateStatusBar?.(`UI automation response failed: ${toText(err?.message) || err}`, { tone: "error" });
  }
}

async function pollOnce() {
  const response = await fetch(`${API_BASE}/ui_automation/commands/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: POLL_CLIENT_ID, timeout_sec: 20 }),
  });
  const payload = await response.json();
  const command = payload?.command;
  if (!command?.id) return;
  let result = null;
  try {
    result = await executeAutomationCommand(command);
  } catch (err) {
    result = { ok: false, error: toText(err?.message) || String(err || "UI automation command failed.") };
  }
  await completeCommand(command.id, result);
}

async function pollLoop() {
  while (!automationStopped) {
    try {
      await pollOnce();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
}

export function initUiAutomation() {
  if (automationStarted) return;
  automationStarted = true;
  automationStopped = false;
  void pollLoop();
}
