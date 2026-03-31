import { redirect } from "next/navigation";

interface SignInPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function SignInPage({ searchParams }: SignInPageProps) {
  const nextValue = Array.isArray(searchParams?.next) ? searchParams?.next[0] : searchParams?.next;
  const query = new URLSearchParams({ auth: "signin" });
  if (nextValue) {
    query.set("next", nextValue);
  }
  redirect(`/?${query.toString()}`);
}
