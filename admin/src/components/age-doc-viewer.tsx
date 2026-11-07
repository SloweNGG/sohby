"use client";

import { useState, useTransition } from "react";
import { openAgeDocumentAction } from "@/lib/actions";
import { btn } from "./shell-classes";

/**
 * Belgeyi yalnızca istenince açar. Her açış veritabanında işlem kaydına
 * yazılır; dönen bağlantı 60 saniye geçerlidir ve önbelleğe alınmaz.
 */
export function AgeDocViewer({
  documentId,
  labels,
}: {
  documentId: string;
  labels: { show: string; hide: string; error: string; notAvailable: string; alt: string };
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (src) {
    return (
      <div className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={labels.alt} referrerPolicy="no-referrer" className="max-h-[70vh] w-full rounded-2xl bg-night-deep object-contain" />
        <button type="button" className={btn} onClick={() => setSrc(null)}>
          {labels.hide}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={btn}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await openAgeDocumentAction(documentId);
            if ("url" in r) setSrc(r.url);
            else setError(r.error === "not_found" ? labels.notAvailable : labels.error);
          })
        }
      >
        {labels.show}
      </button>
      {error && <p className="text-sm text-coral-text">{error}</p>}
    </div>
  );
}
