import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <LoginForm next={next ?? null} />
    </div>
  );
}
