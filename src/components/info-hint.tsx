"use client";

import { Popover } from "@base-ui/react/popover";
import { getContextHelp } from "@/lib/context-help";

/** Read-only help: no business handlers, requests or stored state. */
export function InfoHint({ title, topic = title }: { title: string; topic?: string }) {
  const description = getContextHelp(topic);
  if (!description) return null;
  return (
    <Popover.Root modal={false}>
      <Popover.Trigger
        type="button"
        aria-label={`Пояснение: ${title}`}
        title={`Что это: ${title}`}
        className="focus-ring ml-1.5 inline-flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full border border-teal-500/60 bg-white align-middle font-serif text-[11px] font-semibold leading-none tracking-normal text-teal-800 normal-case shadow-none hover:bg-teal-50"
      >
        <span aria-hidden="true">i</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          positionMethod="fixed"
          className="z-[80]"
        >
          <Popover.Popup
            data-slot="info-hint-popup"
            initialFocus={false}
            className="relative w-[340px] max-w-[calc(100vw-24px)] max-h-[min(80dvh,var(--available-height))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-[18px] pr-10 text-left font-sans text-sm font-normal leading-[1.6] tracking-normal text-slate-600 normal-case shadow-lg outline-none"
          >
            <Popover.Title className="mb-2 text-sm font-semibold leading-5 text-slate-900">{title}</Popover.Title>
            <Popover.Description>{description}</Popover.Description>
            <Popover.Close
              type="button"
              aria-label="Закрыть пояснение"
              className="focus-ring absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span aria-hidden="true">×</span>
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
