"use client";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getContextHelp } from "@/lib/context-help";

/** Read-only help: no business handlers, requests or stored state. */
export function InfoHint({ title, topic = title }: { title: string; topic?: string }) {
  const description = getContextHelp(topic);
  if (!description) return null;
  return (
    <Dialog>
      <DialogTrigger
        type="button"
        aria-label={`Пояснение: ${title}`}
        title={`Что это: ${title}`}
        className="focus-ring ml-1.5 inline-flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full border border-teal-500/60 bg-white align-middle font-serif text-[11px] font-semibold leading-none tracking-normal text-teal-800 normal-case shadow-none hover:bg-teal-50"
      >
        <span aria-hidden="true">i</span>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[min(80dvh,520px)] overflow-y-auto border border-slate-200 bg-white p-5 text-slate-950 sm:max-w-md">
        <DialogTitle className="pr-6 text-base leading-6">{title}</DialogTitle>
        <DialogDescription className="text-sm leading-6 text-slate-600">{description}</DialogDescription>
        <DialogClose type="button" className="focus-ring justify-self-end rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Закрыть пояснение</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
