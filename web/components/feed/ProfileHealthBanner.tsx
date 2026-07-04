import Link from "next/link";

/** Shown on the feed when `profiles.validation_status.status === 'invalid'`. */
export function ProfileHealthBanner({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">Your profile needs a fix before matching can use it fully:</p>
      <ul className="mt-2 list-disc pl-5">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <Link href="/onboarding" className="mt-2 inline-block font-medium underline">
        Fix in onboarding
      </Link>
    </div>
  );
}
