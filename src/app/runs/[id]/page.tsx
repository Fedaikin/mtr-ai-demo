import { redirect } from "next/navigation";
export default async function LegacyRunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  redirect(`/modeling/runs/${encodeURIComponent(id)}`);
}
