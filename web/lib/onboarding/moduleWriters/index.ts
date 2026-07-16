import { parseValuesBody, valuesReceipt, applyValuesToDoc, type ValuesPayload } from "./values";
import { parseEnergyBody, energyReceipt, applyEnergyToDoc, type EnergyPayload } from "./energy";
import { parseEnvironmentBody, environmentReceipt, applyEnvironmentToDoc, type EnvironmentPayload } from "./environment";
import { parseTrajectoryBody, trajectoryReceipt, applyTrajectoryToDoc, type TrajectoryPayload } from "./trajectory";
import { parseDealbreakersBody, dealbreakersReceipt, applyDealbreakersToDoc, type DealbreakersPayload } from "./dealbreakers";

// The five keys this session owns out of the pinned ModuleKey union
// (`anchor` and `reactions` are handled by their own dedicated routes).
export const STRUCTURED_MODULE_KEYS = ["values", "energy", "environment", "trajectory", "dealbreakers"] as const;
export type StructuredModuleKey = (typeof STRUCTURED_MODULE_KEYS)[number];

export function isStructuredModuleKey(key: string): key is StructuredModuleKey {
  return (STRUCTURED_MODULE_KEYS as readonly string[]).includes(key);
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ModuleWriterEntry {
  parseBody(body: unknown): ParseResult<unknown>;
  receipt(data: unknown): string;
  applyToDoc(doc: Record<string, string>, data: unknown): Record<string, string>;
}

/**
 * Registry entry point for the shared `[key]/route.ts` handler and (once
 * 30 lands) `incrementalDoc.ts::applyModuleToDoc`. Each module's
 * validate/receipt/applyToDoc trio is pure and independently unit-tested
 * in its own file — this just type-erases them into one keyed lookup.
 */
export const MODULE_WRITERS: Record<StructuredModuleKey, ModuleWriterEntry> = {
  values: {
    parseBody: (body) => parseValuesBody(body),
    receipt: (data) => valuesReceipt(data as ValuesPayload),
    applyToDoc: (doc, data) => applyValuesToDoc(doc, data as ValuesPayload),
  },
  energy: {
    parseBody: (body) => parseEnergyBody(body),
    receipt: () => energyReceipt(),
    applyToDoc: (doc, data) => applyEnergyToDoc(doc, data as EnergyPayload),
  },
  environment: {
    parseBody: (body) => parseEnvironmentBody(body),
    receipt: () => environmentReceipt(),
    applyToDoc: (doc, data) => applyEnvironmentToDoc(doc, data as EnvironmentPayload),
  },
  trajectory: {
    parseBody: (body) => parseTrajectoryBody(body),
    receipt: (data) => trajectoryReceipt(data as TrajectoryPayload),
    applyToDoc: (doc, data) => applyTrajectoryToDoc(doc, data as TrajectoryPayload),
  },
  dealbreakers: {
    parseBody: (body) => parseDealbreakersBody(body),
    receipt: (data) => dealbreakersReceipt(data as DealbreakersPayload),
    applyToDoc: (doc, data) => applyDealbreakersToDoc(doc, data as DealbreakersPayload),
  },
};

export { VALUE_PAIRS } from "./values";
export { ENVIRONMENT_SCENARIOS } from "./environment";
