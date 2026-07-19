// Must match `web/components/extension/HandoffEmitter.tsx`'s exported
// `HANDOFF_EVENT`/`HandoffDetail` exactly — that file is the other end of
// this same-origin DOM CustomEvent handoff. Duplicated here (rather than
// imported) because this package cannot import from `web/` (see
// engineTypes.ts's header for the same constraint applied to SubmitPacket).
export const HANDOFF_EVENT = "jobify:auth-handoff";

export type HandoffDetail = { access_token: string; refresh_token: string };
