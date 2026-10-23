import type { Status } from "../types";
import { statusLabel } from "../lib/presentation";

export function StatusMark({ status }: { status: Status }) {
  return (
    <span data-status={status} className="status-mark inline-flex items-center rounded px-2 py-1 text-xs font-semibold tracking-wide">
      {statusLabel(status)}
    </span>
  );
}
