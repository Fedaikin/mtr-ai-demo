import { redirect } from "next/navigation";

export default async function LegacyModelingRunPage({ params }: PageProps<"/modeling/runs/[id]">) {
  const { id } = await params;
  redirect(`/runs/${encodeURIComponent(id)}`);
}
