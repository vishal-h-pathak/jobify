import { derivePanelView, type PanelView } from "./panelState";
import { fetchReadyList, type ReadyPosting } from "../ready/readyList";
import { fillFlowErrorMessage, type FillFlowResult } from "../fillFlow/fillFlow";
import type { ChecklistItem, HandoffLine } from "../fillFlow/handoffLines";
import { APP_ORIGIN } from "../config";
import type { AuthState } from "../auth/handoff";
import type { BackgroundResponse, ContentFillRequest, ContentFillResponse } from "../messages";

// The chrome.sidePanel entry point — dependency-light vanilla TS (no
// framework): the panel's state machine is small enough (5 view kinds, one
// selection, one fetch, one fill trigger) that a framework would add
// bundle/audit surface without buying real ergonomics, matching the
// constitution's "minimal permissions / minimal footprint" spirit.
// Everything decidable without I/O lives in panelState.ts and is unit
// tested there; this file is deliberately thin DOM wiring around it.

const CLOSING_COPY = "Everything else is yours — review the page and click Submit yourself.";

let authState: AuthState = { kind: "signed_out" };
let readyList: ReadyPosting[] | null = null;
let activeTabUrl = "";
let selectedPostingId: string | null = null;
let fillResult: FillFlowResult | null = null;
let filling = false;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: "get_auth_state" })) as BackgroundResponse;
  authState = response.state;

  chrome.runtime.onMessage.addListener((message: { type?: string; state?: AuthState }) => {
    if (message?.type === "auth_state_changed" && message.state) {
      authState = message.state;
      if ((authState.kind === "signed_in" || authState.kind === "refreshing") && readyList === null) void loadReadyList();
      render();
    }
  });

  const tab = await activeTab();
  activeTabUrl = tab?.url ?? "";

  if (authState.kind === "signed_in" || authState.kind === "refreshing") await loadReadyList();
  render();
}

async function loadReadyList(): Promise<void> {
  try {
    readyList = await fetchReadyList({ fetchImpl: fetch, appOrigin: APP_ORIGIN });
  } catch {
    readyList = [];
  }
  render();
}

function select(postingId: string | null): void {
  selectedPostingId = postingId;
  fillResult = null;
  render();
}

async function fillThisPage(): Promise<void> {
  if (!selectedPostingId) return;
  const tab = await activeTab();
  if (!tab?.id) return;
  filling = true;
  render();
  const request: ContentFillRequest = { type: "fill_this_page", postingId: selectedPostingId };
  try {
    fillResult = (await chrome.tabs.sendMessage(tab.id, request)) as ContentFillResponse;
  } finally {
    filling = false;
    render();
  }
}

function el(tag: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function copyableLine(line: HandoffLine): HTMLElement {
  const row = el("div");
  row.className = "handoff-line";
  row.appendChild(el("span", `${line.label}: ${line.value}`));
  const button = el("button", "Copy") as HTMLButtonElement;
  button.addEventListener("click", () => void navigator.clipboard.writeText(line.value));
  row.appendChild(button);
  return row;
}

function checklistItem(item: ChecklistItem): HTMLElement {
  const row = el("div");
  const mark = item.status === "filled" ? "✓" : item.status === "stuck" ? "⚠" : "•";
  row.className = `checklist-item checklist-${item.status}`;
  row.textContent = `${mark} ${item.label}`;
  return row;
}

function renderFillResult(result: FillFlowResult): HTMLElement {
  const container = el("div");
  const message = fillFlowErrorMessage(result);
  if (message) {
    container.appendChild(el("p", message));
    return container;
  }

  if (result.kind === "generic") {
    container.appendChild(el("p", "This ATS isn't one we can auto-fill yet — here's everything to paste by hand."));
    for (const line of result.handoffLines) container.appendChild(copyableLine(line));
    container.appendChild(el("p", CLOSING_COPY));
    return container;
  }

  if (result.kind === "filled") {
    const checklist = el("div");
    checklist.className = "checklist";
    for (const item of result.checklist) checklist.appendChild(checklistItem(item));
    container.appendChild(checklist);

    if (result.handoffLines.length > 0) {
      container.appendChild(el("h3", "Paste these by hand"));
      for (const line of result.handoffLines) container.appendChild(copyableLine(line));
    }
    if (result.reminders.length > 0) {
      container.appendChild(el("h3", "Still needed"));
      for (const reminder of result.reminders) container.appendChild(el("p", reminder));
    }
    container.appendChild(el("p", CLOSING_COPY));
  }

  return container;
}

function renderView(view: PanelView): HTMLElement {
  const container = el("div");

  switch (view.kind) {
    case "signed_out": {
      container.appendChild(el("p", "Sign in to jobify to fill out applications from here."));
      const link = el("a", "Sign in") as HTMLAnchorElement;
      link.href = `${APP_ORIGIN}/login`;
      link.target = "_blank";
      container.appendChild(link);
      break;
    }

    case "loading":
      container.appendChild(el("p", "Loading..."));
      break;

    case "ready_list": {
      if (view.postings.length === 0) {
        container.appendChild(el("p", "No tailored applications ready to submit yet."));
        break;
      }
      const list = el("ul");
      for (const posting of view.postings) {
        const item = el("li");
        const button = el("button", `${posting.title} — ${posting.company}`) as HTMLButtonElement;
        if (view.highlighted.some((h) => h.posting_id === posting.posting_id)) button.classList.add("highlighted");
        button.addEventListener("click", () => select(posting.posting_id));
        item.appendChild(button);
        list.appendChild(item);
      }
      container.appendChild(list);
      break;
    }

    case "selected": {
      container.appendChild(el("h2", `${view.posting.title} — ${view.posting.company}`));

      const back = el("button", "← Back to list") as HTMLButtonElement;
      back.addEventListener("click", () => select(null));
      container.appendChild(back);

      if (fillResult) {
        container.appendChild(renderFillResult(fillResult));
      } else {
        const fillButton = el("button", filling ? "Filling..." : "Fill this page") as HTMLButtonElement;
        fillButton.disabled = filling;
        fillButton.addEventListener("click", () => void fillThisPage());
        container.appendChild(fillButton);
      }
      break;
    }
  }

  return container;
}

function render(): void {
  const root = document.getElementById("panel-root");
  if (!root) return;
  const view = derivePanelView(authState, readyList, activeTabUrl, selectedPostingId);
  root.replaceChildren(renderView(view));
}

void init();
