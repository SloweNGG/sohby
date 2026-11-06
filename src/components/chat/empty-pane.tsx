import { MessagesSquare } from "lucide-react";

/** Masaüstünde sağ panel boşken gösterilir. */
export function EmptyPane({ title, body }: { title: string; body: string }) {
  return (
    <div className="hidden h-full flex-col items-center justify-center px-8 text-center md:flex">
      <MessagesSquare className="mb-4 h-10 w-10 text-muted" strokeWidth={1.5} aria-hidden="true" />
      <h2 className="text-2xl">{title}</h2>
      <p className="mt-2 max-w-sm text-muted">{body}</p>
    </div>
  );
}
