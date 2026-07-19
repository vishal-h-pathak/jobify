// web/components/submit/AnswerSheet.tsx
import { Button } from "@/components/ui/Button";
import type { SubmitPacket } from "./types";

export interface AnswerSheetRow {
  label: string;
  value: string;
}

export interface AnswerSheetSection {
  key: "identity" | "authorization" | "logistics" | "self_id";
  heading: string;
  voluntary?: boolean;
  rows: AnswerSheetRow[];
}

const IDENTITY_LABELS: Record<keyof SubmitPacket["identity"], string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Portfolio",
};

const AUTHORIZATION_LABELS: Record<keyof SubmitPacket["authorization"], string> = {
  work_authorized: "Authorized to work",
  visa_sponsorship_needed: "Needs visa sponsorship",
  notes: "Notes",
};

const LOGISTICS_LABELS: Record<keyof SubmitPacket["logistics"], string> = {
  notice_period: "Notice period",
  earliest_start: "Earliest start",
  salary_expectation: "Salary expectation",
};

const SELF_ID_LABELS: Record<keyof SubmitPacket["self_id"], string> = {
  gender: "Gender",
  race_ethnicity: "Race / ethnicity",
  veteran_status: "Veteran status",
  disability_status: "Disability status",
};

function rowsFrom<K extends string>(obj: Partial<Record<K, string>>, labels: Record<K, string>): AnswerSheetRow[] {
  return (Object.keys(labels) as K[])
    .map((key) => ({ label: labels[key], value: (obj[key] ?? "").trim() }))
    .filter((row) => row.value.length > 0);
}

/**
 * Render-what-exists (session 39 spec): a section with zero non-empty rows
 * doesn't render at all. NOTHING appears that isn't in the packet — this
 * function never fabricates a value.
 */
export function answerSheetSections(packet: SubmitPacket): AnswerSheetSection[] {
  const sections: AnswerSheetSection[] = [
    { key: "identity", heading: "Identity", rows: rowsFrom(packet.identity, IDENTITY_LABELS) },
    { key: "authorization", heading: "Authorization", rows: rowsFrom(packet.authorization, AUTHORIZATION_LABELS) },
    { key: "logistics", heading: "Logistics", rows: rowsFrom(packet.logistics, LOGISTICS_LABELS) },
    {
      key: "self_id",
      heading: "Self-identification",
      voluntary: true,
      rows: rowsFrom(packet.self_id, SELF_ID_LABELS),
    },
  ];
  return sections.filter((s) => s.rows.length > 0);
}

export function AnswerSheet({ packet }: { packet: SubmitPacket }) {
  const sections = answerSheetSections(packet);
  if (sections.length === 0) return null;
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium text-ink">Answer sheet</h2>
      {sections.map((section) => (
        <div
          key={section.key}
          className={
            section.voluntary
              ? "flex flex-col gap-2 rounded-md border border-amber/30 bg-amber/5 p-3"
              : "flex flex-col gap-2"
          }
        >
          <h3 className="text-sm font-medium text-ink">
            {section.heading}
            {section.voluntary && (
              <span className="ml-2 text-xs font-normal text-ink-muted">voluntary — you chose to store these</span>
            )}
          </h3>
          {section.rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex flex-col">
                <span className="text-xs text-ink-muted">{row.label}</span>
                <span className="text-ink">{row.value}</span>
              </div>
              <Button
                variant="ghost"
                className="print:hidden"
                onClick={() => navigator.clipboard.writeText(row.value)}
              >
                Copy
              </Button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
