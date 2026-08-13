import { redirect } from "next/navigation";

export default async function LegacyModelingPage({ searchParams }: PageProps<"/modeling">) {
  const params = await searchParams;
  redirect(params.tab === "runs" ? "/admin/scenarios?tab=runs" : "/admin/scenarios");
}
