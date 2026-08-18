import { CHASSIS_TEXT } from "@text/chassis";

/**
 * The logs view — the work surface it fills is IKN-12's.
 *
 * This page exists so the chassis has its M1 view and `/` has somewhere to land, which is what
 * lets nginx stop serving the static mock (IKN-4). What it deliberately does not do is draw a
 * plausible-looking log table: the data is real and reachable, but a fake table is exactly the
 * "no lorem numbers" the design doc rules out, and it would have to be deleted to build the real
 * one anyway.
 */
export default function LogsPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-ui text-work-text-muted">{CHASSIS_TEXT.workSurfacePending}</p>
    </div>
  );
}
