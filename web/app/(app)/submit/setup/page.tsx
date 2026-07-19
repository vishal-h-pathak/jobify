"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, TextArea } from "@/components/ui/Input";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { StepRail } from "@/components/submit/StepRail";
import {
  SUBMIT_STEP_ORDER,
  SELF_ID_PRIVACY_COPY,
  nextStepKey,
  prevStepKey,
  formValuesFromProfile,
  buildApplicationProfilePayload,
  summarizeApplicationProfile,
  resolveReturnTo,
  EMPTY_APPLICATION_FORM_VALUES,
  type ApplicationFormValues,
  type SubmitStepKey,
} from "@/components/submit/wizard";
import { fetchApplicationProfile, saveApplicationProfile } from "@/components/submit/api";

const SELECT_CLASSES =
  "w-full rounded-md border border-line bg-base px-3 py-2 text-[15px] text-ink disabled:cursor-not-allowed disabled:opacity-50";

/**
 * DI'd exactly like onboarding's `navigateToProfile` (web/app/(app)/onboarding/page.tsx)
 * — vitest runs in the `node` environment (no `window`), so the real
 * `window.location.assign` call can only be exercised through injection.
 */
export function navigateAfterSave(
  returnTo: string | null,
  assignImpl: (url: string) => void = (url) => window.location.assign(url)
): void {
  assignImpl(resolveReturnTo(returnTo));
}

export default function SubmitSetupPage() {
  const [step, setStep] = useState<SubmitStepKey>(SUBMIT_STEP_ORDER[0]);
  const [values, setValues] = useState<ApplicationFormValues>(EMPTY_APPLICATION_FORM_VALUES);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    // Plain browser API, not next/navigation's useSearchParams, matching
    // onboarding's ?module= deep link (web/app/(app)/onboarding/page.tsx) —
    // avoids forcing a Suspense boundary on an already-fully-client page.
    const params = new URLSearchParams(window.location.search);
    setReturnTo(params.get("returnTo"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchApplicationProfile()
      .then((profile) => {
        if (cancelled) return;
        setValues(formValuesFromProfile(profile));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Couldn't load your application defaults — try refreshing.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function field<K extends keyof ApplicationFormValues>(key: K, value: ApplicationFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function goNext() {
    const next = nextStepKey(step);
    if (next) setStep(next);
  }

  function goBack() {
    const prev = prevStepKey(step);
    if (prev) setStep(prev);
  }

  async function handleSave() {
    setSubmitting(true);
    setSaveError("");
    try {
      await saveApplicationProfile(buildApplicationProfilePayload(values));
      navigateAfterSave(returnTo);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save — try again.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center px-6 py-10">
        <Spinner />
      </div>
    );
  }

  const reviewSections = summarizeApplicationProfile(buildApplicationProfilePayload(values));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Application defaults</h1>
        <p className="text-sm text-ink-muted">
          Everything here is optional — fill in what you want, skip the rest. It saves once, then fills every submit
          kit from here on.
        </p>
      </div>

      <StepRail current={step} />

      {loadError && <Banner tone="danger">{loadError}</Banner>}

      {step === "contact" && (
        <div className="flex flex-col gap-4">
          <h2 className="font-medium text-ink">Contact</h2>
          <LabeledInput label="Phone (optional)" value={values.phone} onChange={(v) => field("phone", v)} />
          <LabeledInput label="Location (optional)" value={values.location} onChange={(v) => field("location", v)} />
          <LabeledInput
            label="LinkedIn URL (optional)"
            value={values.linkedin_url}
            onChange={(v) => field("linkedin_url", v)}
          />
          <LabeledInput
            label="GitHub URL (optional)"
            value={values.github_url}
            onChange={(v) => field("github_url", v)}
          />
          <LabeledInput
            label="Portfolio URL (optional)"
            value={values.portfolio_url}
            onChange={(v) => field("portfolio_url", v)}
          />
        </div>
      )}

      {step === "authorization" && (
        <div className="flex flex-col gap-4">
          <h2 className="font-medium text-ink">Work authorization</h2>
          <LabeledSelect
            label="Authorized to work (optional)"
            value={values.work_authorized}
            onChange={(v) => field("work_authorized", v as ApplicationFormValues["work_authorized"])}
          />
          <LabeledSelect
            label="Needs visa sponsorship (optional)"
            value={values.visa_sponsorship_needed}
            onChange={(v) => field("visa_sponsorship_needed", v as ApplicationFormValues["visa_sponsorship_needed"])}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="authorization-notes" className="text-sm text-ink-muted">
              Notes (optional)
            </label>
            <TextArea
              id="authorization-notes"
              value={values.authorization_notes}
              onChange={(e) => field("authorization_notes", e.target.value)}
            />
          </div>
        </div>
      )}

      {step === "logistics" && (
        <div className="flex flex-col gap-4">
          <h2 className="font-medium text-ink">Logistics</h2>
          <LabeledInput
            label="Notice period (optional)"
            value={values.notice_period}
            onChange={(v) => field("notice_period", v)}
            placeholder="2 weeks"
          />
          <LabeledInput
            label="Earliest start (optional)"
            value={values.earliest_start}
            onChange={(v) => field("earliest_start", v)}
            placeholder="Immediately"
          />
          <LabeledInput
            label="Salary expectation (optional)"
            value={values.salary_expectation}
            onChange={(v) => field("salary_expectation", v)}
            placeholder="$150k+"
          />
        </div>
      )}

      {step === "self_id" && (
        <div className="flex flex-col gap-4">
          <h2 className="font-medium text-ink">Voluntary self-identification</h2>
          <p className="text-sm text-ink-muted">{SELF_ID_PRIVACY_COPY}</p>
          <LabeledInput label="Gender (optional)" value={values.gender} onChange={(v) => field("gender", v)} />
          <LabeledInput
            label="Race / ethnicity (optional)"
            value={values.race_ethnicity}
            onChange={(v) => field("race_ethnicity", v)}
          />
          <LabeledInput
            label="Veteran status (optional)"
            value={values.veteran_status}
            onChange={(v) => field("veteran_status", v)}
          />
          <LabeledInput
            label="Disability status (optional)"
            value={values.disability_status}
            onChange={(v) => field("disability_status", v)}
          />
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-4">
          <h2 className="font-medium text-ink">Review</h2>
          {reviewSections.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nothing filled in — that&apos;s fine, you can save empty and add details later.
            </p>
          ) : (
            reviewSections.map((section) => (
              <div key={section.heading} className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-ink">
                  {section.heading}
                  {section.voluntary && <span className="ml-2 text-xs font-normal text-ink-muted">voluntary</span>}
                </h3>
                {section.rows.map((row) => (
                  <p key={row.label} className="text-sm text-ink-muted">
                    {row.label}: <span className="text-ink">{row.value}</span>
                  </p>
                ))}
              </div>
            ))
          )}
          {saveError && <p className="text-sm text-danger">{saveError}</p>}
          <Button variant="primary" busy={submitting} onClick={handleSave}>
            Save
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        {prevStepKey(step) ? (
          <Button variant="ghost" onClick={goBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {step !== "review" && (
          <Button variant="secondary" onClick={goNext}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = `submit-setup-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `submit-setup-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASSES}>
        <option value="">Prefer not to say</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
  );
}
