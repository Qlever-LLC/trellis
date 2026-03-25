/**
 * Base class for all Trellis-specific errors.
 * Extends BaseError and relies on the traceId getter being configured via initTracing.
 */
import { BaseError, type BaseErrorSchema } from "../../result/mod.ts";

/**
 * Abstract base class for Trellis errors.
 * Trellis errors automatically include traceId when initTracing() has been called
 * and a span is active in the current context.
 *
 * The traceId integration is configured by the tracing module's initTracing() function,
 * which sets up BaseError.traceIdGetter to retrieve the traceId from the active span.
 */
export abstract class TrellisError<
  TData extends BaseErrorSchema = BaseErrorSchema,
> extends BaseError<TData> {
  // TrellisError inherits getTraceId() from BaseError which uses the static traceIdGetter.
  // The traceIdGetter is configured by initTracing() in the tracing module.
}
