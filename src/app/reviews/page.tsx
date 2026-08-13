import { getRepository } from "@/adapters/persistence/repository";
import { AnalysisReviewQueue } from "@/components/analysis-review-queue";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function ReviewsPage() {
  const [session, repository] = await Promise.all([requirePermission("review.queue.read"), getRepository()]);
  const [latest] = await repository.listRuns(session.user.id, { status: "COMPLETED", limit: 1, includeSteps: false });
  const reviews = latest ? await repository.listAnalysisReviews(session.user.id, latest.id) : [];
  return <><PageHeader eyebrow="Экспертный контроль" title="Очередь Даблчекера МТР" description="Независимые доказательства и решения эксперта. Автоматического закупочного решения система не принимает." /><AnalysisReviewQueue initialReviews={reviews} /></>;
}
