import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export type AnchorFormMode = "role" | "situation";

export interface AnchorFormValues {
  mode: AnchorFormMode;
  currentTitle: string;
  currentCompany: string;
  yearsInRole: string;
  freeText: string;
}

export const initialAnchorFormValues: AnchorFormValues = {
  mode: "role",
  currentTitle: "",
  currentCompany: "",
  yearsInRole: "",
  freeText: "",
};

/**
 * Mirrors POST /api/onboarding/anchor's own validation (web/app/api/onboarding/anchor/route.ts)
 * so the submit button only enables when the request would actually succeed:
 * either the title+company pair, or free text, is required — never neither.
 */
export function anchorFormErrors(values: AnchorFormValues): string[] {
  if (values.mode === "role") {
    const errors: string[] = [];
    if (!values.currentTitle.trim()) errors.push("Enter your current title.");
    if (!values.currentCompany.trim()) errors.push("Enter your current company.");
    return errors;
  }

  const hasFreeText = values.freeText.trim().length > 0;
  const hasRolePair = values.currentTitle.trim().length > 0 && values.currentCompany.trim().length > 0;
  if (!hasFreeText && !hasRolePair) {
    return ["Describe your situation, or fill in your most recent title and company."];
  }
  return [];
}

export function anchorFormValid(values: AnchorFormValues): boolean {
  return anchorFormErrors(values).length === 0;
}

/**
 * Matches the server's own precedence exactly (anchor/route.ts:59-65): free
 * text wins over the title/company pair whenever both are present, since
 * it's the more specific signal for the "doesn't fit a title" case.
 */
export function buildAnchorPayload(values: AnchorFormValues): Record<string, string> {
  const freeText = values.freeText.trim();
  if (values.mode === "situation" && freeText) {
    return { free_text: freeText };
  }
  const payload: Record<string, string> = {
    current_title: values.currentTitle.trim(),
    current_company: values.currentCompany.trim(),
  };
  const years = values.yearsInRole.trim();
  if (years) payload.years_in_role = years;
  return payload;
}

export interface AnchorFormProps {
  values: AnchorFormValues;
  submitting: boolean;
  error: string;
  onFieldChange: (field: keyof Omit<AnchorFormValues, "mode">, value: string) => void;
  onModeToggle: () => void;
  onSubmit: () => void;
}

export function AnchorForm({ values, submitting, error, onFieldChange, onModeToggle, onSubmit }: AnchorFormProps) {
  const valid = anchorFormValid(values);
  const titleLabel = values.mode === "role" ? "Current title" : "Most recent title";
  const companyLabel = values.mode === "role" ? "Current company" : "Most recent company";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-3xl font-semibold tracking-tight text-ink">What&apos;s your role?</h2>
        <p className="text-sm text-ink-muted">Anchors your first few questions — no wrong answer here.</p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="anchor-title" className="text-sm text-ink-muted">
            {titleLabel}
          </label>
          <Input
            id="anchor-title"
            value={values.currentTitle}
            onChange={(e) => onFieldChange("currentTitle", e.target.value)}
            placeholder="Staff Engineer"
            disabled={submitting}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="anchor-company" className="text-sm text-ink-muted">
            {companyLabel}
          </label>
          <Input
            id="anchor-company"
            value={values.currentCompany}
            onChange={(e) => onFieldChange("currentCompany", e.target.value)}
            placeholder="Acme Corp"
            disabled={submitting}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="anchor-tenure" className="text-sm text-ink-muted">
            Years in role (optional)
          </label>
          <Input
            id="anchor-tenure"
            value={values.yearsInRole}
            onChange={(e) => onFieldChange("yearsInRole", e.target.value)}
            placeholder="3"
            disabled={submitting}
          />
        </div>

        {values.mode === "situation" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="anchor-situation" className="text-sm text-ink-muted">
              Or describe your situation
            </label>
            <textarea
              id="anchor-situation"
              value={values.freeText}
              onChange={(e) => onFieldChange("freeText", e.target.value)}
              placeholder="Between roles, a student, switching careers — whatever fits."
              rows={3}
              disabled={submitting}
              className="w-full rounded-md border border-line bg-base px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        )}

        <button
          type="button"
          onClick={onModeToggle}
          className="self-start text-sm text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
        >
          {values.mode === "role" ? "I'm between roles / this doesn't fit" : "I have a current title after all"}
        </button>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" variant="primary" busy={submitting} disabled={submitting || !valid}>
          Continue
        </Button>
      </form>
    </div>
  );
}
