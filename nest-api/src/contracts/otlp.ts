/**
 * What `POST /api/otlp/v1/traces` answers on success (IKN-87) — the OTLP/HTTP JSON
 * `ExportTraceServiceResponse`.
 *
 * `partialSuccess` is always present, and empty when every span was stored: the OTLP spec reads an
 * empty object (or no field) as full success, and an exporter that only checks for
 * `rejectedSpans` sees nothing to report. When spans were refused, `rejectedSpans` counts them and
 * `errorMessage` names the distinct reasons. Duplicates of spans already stored are not rejections
 * — they *were* stored, by the request that sent them first.
 */
export type OtlpExportResponse = {
  partialSuccess: {
    rejectedSpans?: number;
    errorMessage?: string;
  };
};
