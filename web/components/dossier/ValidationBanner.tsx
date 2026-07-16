import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import type { ValidationSurface } from "@/lib/dossier/derive";

/** Never shows a raw validator string — `derive.ts` already reduced every
 * issue to plain words + a "Fix in <module>" link (V3A_DESIGN §3). */
export function ValidationBanner({ validation }: { validation: ValidationSurface }) {
  if (!validation.hasIssues) return null;
  return (
    <Banner tone="danger">
      <p className="font-medium">{validation.bannerText}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {validation.issues.map((issue) => (
          <li key={issue.section} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
            <span>{issue.message}</span>
            <Link href={issue.fixHref} className="text-amber hover:underline">
              Fix
            </Link>
          </li>
        ))}
      </ul>
    </Banner>
  );
}
