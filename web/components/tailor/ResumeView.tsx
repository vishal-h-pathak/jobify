"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { SourceChip, highlightNumbers } from "./SourceChip";
import type { ClaimUnit } from "./types";

const EXP_HEADER_RE = /^r\.exp(\d+)\.header$/;
const EXP_BULLET_RE = /^r\.exp(\d+)\.b(\d+)$/;
const EDU_RE = /^r\.edu(\d+)$/;
const SKILL_RE = /^r\.skill(\d+)$/;

export interface ResumeExperienceGroup {
  index: number;
  header: ClaimUnit | null;
  bullets: ClaimUnit[];
}

export interface ResumeSections {
  experience: ResumeExperienceGroup[];
  education: ClaimUnit[];
  skills: ClaimUnit[];
  summary: ClaimUnit | null;
}

/**
 * Groups `claims.json`'s flat `units[]` back into resume sections by
 * parsing the id scheme (`r.exp{i}.header`/`r.exp{i}.b{j}`/`r.edu{i}`/
 * `r.skill{i}`/`r.summary`) rather than walking `tailored.json`'s array
 * positions — filtering removes dropped entries, so post-filter array
 * indices no longer line up with the `i`/`j` the ids were minted from.
 */
export function groupResumeUnits(units: ClaimUnit[]): ResumeSections {
  const resumeUnits = units.filter((u) => u.surface === "resume");
  const experienceMap = new Map<number, ResumeExperienceGroup>();

  for (const unit of resumeUnits) {
    const headerMatch = EXP_HEADER_RE.exec(unit.id);
    if (headerMatch) {
      const index = Number(headerMatch[1]);
      const group = experienceMap.get(index) ?? { index, header: null, bullets: [] };
      group.header = unit;
      experienceMap.set(index, group);
      continue;
    }
    const bulletMatch = EXP_BULLET_RE.exec(unit.id);
    if (bulletMatch) {
      const index = Number(bulletMatch[1]);
      const group = experienceMap.get(index) ?? { index, header: null, bullets: [] };
      group.bullets.push(unit);
      experienceMap.set(index, group);
    }
  }

  const experience = Array.from(experienceMap.values())
    .filter((g) => g.header !== null)
    .sort((a, b) => a.index - b.index)
    .map((g) => ({
      ...g,
      bullets: [...g.bullets].sort((a, b) => Number(EXP_BULLET_RE.exec(a.id)![2]) - Number(EXP_BULLET_RE.exec(b.id)![2])),
    }));

  const education = resumeUnits
    .filter((u) => EDU_RE.test(u.id))
    .sort((a, b) => Number(EDU_RE.exec(a.id)![1]) - Number(EDU_RE.exec(b.id)![1]));

  const skills = resumeUnits
    .filter((u) => SKILL_RE.test(u.id))
    .sort((a, b) => Number(SKILL_RE.exec(a.id)![1]) - Number(SKILL_RE.exec(b.id)![1]));

  const summary = resumeUnits.find((u) => u.id === "r.summary") ?? null;

  return { experience, education, skills, summary };
}

function BulletText({ unit }: { unit: ClaimUnit }) {
  const segments = highlightNumbers(unit.text ?? "", unit.numbers);
  return (
    <span>
      {segments.map((seg, i) =>
        seg.isMetric ? (
          <span key={i} className="font-medium text-amber">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

/**
 * A `text`-bearing unit (bullet/skill/summary/cl_sentence/voice), rendered
 * read-only with its chip, or — when `onEdit` is supplied and the reader
 * clicks "Edit" — a plain textarea that commits on blur/Enter. Structural
 * units (header/edu, `fields`-based) have no free-text surface to edit and
 * never receive this control (design §2.5 scopes inline edit to claim
 * text, not to structural facts like org/title/dates).
 */
function EditableClaim({ unit, onEdit }: { unit: ClaimUnit; onEdit?: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(unit.text ?? "");

  if (editing) {
    return (
      <span className="flex flex-1 items-start gap-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== unit.text) onEdit?.(unit.id, draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          rows={2}
          className="flex-1 rounded-md border border-line bg-base p-1.5 text-sm text-ink"
        />
      </span>
    );
  }

  return (
    <span className="flex-1">
      <BulletText unit={unit} /> <SourceChip unit={unit} />
      {onEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(unit.text ?? "");
            setEditing(true);
          }}
          className="ml-1 text-xs text-ink-muted hover:text-amber"
        >
          Edit
        </button>
      )}
    </span>
  );
}

export function ResumeView({ units, onEdit }: { units: ClaimUnit[]; onEdit?: (id: string, text: string) => void }) {
  const sections = groupResumeUnits(units);

  return (
    <Card className="flex flex-col gap-5">
      {sections.summary && (
        <p className="flex items-start text-sm text-ink">
          <EditableClaim unit={sections.summary} onEdit={onEdit} />
        </p>
      )}

      {sections.experience.map((exp) => (
        <div key={exp.index} className="flex flex-col gap-2">
          {exp.header?.fields && (
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="font-medium text-ink">{exp.header.fields.title}</p>
                <p className="text-sm text-ink-muted">
                  {exp.header.fields.org} · {exp.header.fields.location}
                </p>
              </div>
              <p className="text-xs text-ink-muted">{exp.header.fields.period}</p>
            </div>
          )}
          <ul className="flex flex-col gap-1.5">
            {exp.bullets.map((bullet) => (
              <li key={bullet.id} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                <EditableClaim unit={bullet} onEdit={onEdit} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {sections.education.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="border-b border-line pb-2 text-xs uppercase tracking-[0.2em] text-ink-muted">Education</p>
          {sections.education.map((edu) => (
            <div key={edu.id} className="flex items-baseline justify-between gap-3 text-sm text-ink">
              <span>
                {edu.fields?.school} — {edu.fields?.degree} <SourceChip unit={edu} />
              </span>
              <span className="text-xs text-ink-muted">{edu.fields?.period}</span>
            </div>
          ))}
        </div>
      )}

      {sections.skills.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="border-b border-line pb-2 text-xs uppercase tracking-[0.2em] text-ink-muted">Skills</p>
          {sections.skills.map((skill) => (
            <p key={skill.id} className="flex items-start text-sm text-ink">
              <EditableClaim unit={skill} onEdit={onEdit} />
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
