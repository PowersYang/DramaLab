import { redirect } from "next/navigation";

interface SignUpPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function SignUpPage({ searchParams }: SignUpPageProps) {
  const nextValue = Array.isArray(searchParams?.next) ? searchParams?.next[0] : searchParams?.next;
  const query = new URLSearchParams({ auth: "signup" });
  if (nextValue) {
    query.set("next", nextValue);
  }
  redirect(`/?${query.toString()}`);
}
