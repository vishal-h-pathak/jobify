"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Input";
import { FileButton } from "@/components/ui/FileButton";
import { Banner } from "@/components/ui/Banner";

// Mirrors web/app/(app)/onboarding/page.tsx's upload validation — that file
// is out of this session's ownership, so this is intentionally a small
// standalone copy rather than a shared import.
const ALLOWED_UPLOAD_EXTENSIONS = [".txt", ".md"];

function validateUploadName(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const ok = ALLOWED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
  return ok ? null : "Please upload a .txt or .md file.";
}

/**
 * Session 29 (ONB-D) task 2: paste-or-upload a resume any time after
 * onboarding, POSTing to /api/settings/resume which calls ONB-A's
 * regenerateCv. router.refresh() re-fetches the settings page's server
 * component so the provenance line above updates without a full reload.
 */
export function ResumeForm() {
  const router = useRouter();
  const [resumeText, setResumeText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleFile(file: File) {
    const uploadError = validateUploadName(file.name);
    if (uploadError) {
      setError(uploadError);
      return;
    }
    setError("");
    setFileName(file.name);
    setResumeText(await file.text());
  }

  async function submit() {
    const text = resumeText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch("/api/settings/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setSuccess(true);
      setResumeText("");
      setFileName(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <TextArea
        value={resumeText}
        onChange={(e) => setResumeText(e.target.value)}
        placeholder="Paste your resume text here…"
      />
      <div className="flex items-center gap-2">
        <FileButton
          id="settings-resume-upload"
          fileName={fileName}
          onFileChange={handleFile}
          accept=".txt,.md"
          label="Upload .txt/.md"
        />
        <Button variant="primary" onClick={submit} busy={submitting} disabled={!resumeText.trim()}>
          Save resume
        </Button>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      {success && (
        <p className="text-sm text-ink-muted">Saved — run a fresh hunt to pick up the update.</p>
      )}
    </div>
  );
}
