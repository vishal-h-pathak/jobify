import { survey, planFills, executeFills } from "jobify-engine";
import { runFillFlow } from "../fillFlow/fillFlow";
import { APP_ORIGIN } from "../config";
import type { EngineApi } from "../engineApi";
import type { ContentFillRequest } from "../messages";

/**
 * The ATS-host content script (manifest.json matches: greenhouse.io,
 * lever.co, ashby*.com, myworkday*.com — mirrors `web/lib/submit/
 * atsDetect.ts`). The ONLY file in this package that imports the real
 * engine (see `types/jobify-engine.d.ts`'s header for why that's safe to
 * type-check standalone) — everything downstream of it (`runFillFlow`) is
 * the same dependency-injected, already-tested orchestration used by
 * `fillFlow.test.ts`'s fake engine.
 *
 * Runs entirely in the page's own execution context, so `document` here IS
 * the ATS tab's DOM — this is deliberately the one place `runFillFlow`'s
 * `root` argument is real. The result it sends back (`ContentFillResponse`
 * = `FillFlowResult`) is plain JSON — no `File`/`Blob`, which extension
 * messaging can't carry — because materials are fetched (materials.ts) and
 * fed straight into `executeFills` inside this same call, never crossing a
 * message boundary.
 */
export function installAtsFillBridge(engine: EngineApi = { survey, planFills, executeFills }): void {
  chrome.runtime.onMessage.addListener((message: ContentFillRequest, _sender, sendResponse) => {
    if (message?.type !== "fill_this_page") return undefined;
    runFillFlow({ engine, fetchImpl: fetch, appOrigin: APP_ORIGIN }, document, message.postingId).then(sendResponse);
    return true; // keep the channel open for the async response
  });
}
