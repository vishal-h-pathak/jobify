import Link from "next/link";
import { Banner } from "@/components/ui/Banner";

/** Shown on the feed when `profiles.validation_status.status === 'invalid'`. */
export function ProfileHealthBanner({ errors }: { errors: string[] }) {
  return (
    <Banner tone="danger">
      <p className="font-medium">Your profile needs a fix before matching can use it fully:</p>
      <ul className="mt-2 list-disc pl-5 text-ink-muted">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <Link href="/onboarding" className="mt-2 inline-block font-medium text-amber underline">
        Fix in onboarding
      </Link>
    </Banner>
  );
}
