/**
 * AWS-specific span attribute names used by the aws-sdk channel integration.
 *
 * These mirror the constants the OTel `@opentelemetry/instrumentation-aws-sdk` emits (some are
 * unstable/obsolete OTel semantic conventions with no `ATTR_*` export in
 * `@opentelemetry/semantic-conventions`), inlined here so the integration stays free of OTel deps.
 * Standard conventions (`rpc.*`, `db.*`, `messaging.*`, `gen_ai.*`, ...) come from
 * `@sentry/conventions/attributes` directly.
 */

/** The span origin every aws-sdk channel span carries, mirroring the uniform OTel `auto.otel.aws`. */
export const AWS_SDK_ORIGIN = 'auto.aws.orchestrion.aws-sdk';

export const ATTR_RPC_SYSTEM = 'rpc.system';
export const CLOUD_REGION = 'cloud.region';
export const AWS_REQUEST_ID = 'aws.request.id';
export const AWS_REQUEST_EXTENDED_ID = 'aws.request.extended_id';
