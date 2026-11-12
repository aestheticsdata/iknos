import { RunDetailView } from "@components/traces/detail/RunDetailView";

/**
 * `/traces/<trace id>` — one AI pipeline run (IKN-92). Keyed by the run, so the picked span and the
 * hover of one run never carry into the next.
 */
export default async function RunPage({ params }: RunPageProps) {
  const { traceId } = await params;
  return (
    <RunDetailView
      key={traceId}
      traceId={traceId}
    />
  );
}

type RunPageProps = {
  params: Promise<{ traceId: string }>;
};
