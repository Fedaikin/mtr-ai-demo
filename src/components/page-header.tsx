import type { ReactNode } from "react";
import { InfoHint } from "@/components/info-hint";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  helpTopic,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  helpTopic?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">{eyebrow}</p>
        ) : null}
        <h1 aria-label={title} className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}<InfoHint title={title} topic={helpTopic} /></h1>
        {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
