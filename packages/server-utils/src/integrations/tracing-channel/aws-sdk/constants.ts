/**
 * AWS-specific span attribute names used by the aws-sdk channel integration.
 *
 * These mirror the constants the OTel `@opentelemetry/instrumentation-aws-sdk` emits (some are
 * unstable/obsolete OTel semantic conventions with no `ATTR_*` export in
 * `@opentelemetry/semantic-conventions`), inlined here so the integration stays free of OTel deps.
 * Attributes that exist in `@sentry/conventions/attributes` are imported from there instead;
 * TODO(aws-sdk): the active attributes below are being added to sentry-conventions and should move
 * to `@sentry/conventions/attributes` imports once a release containing them ships.
 */

/** The span origin every aws-sdk channel span carries, mirroring the uniform OTel `auto.otel.aws`. */
export const AWS_SDK_ORIGIN = 'auto.aws.orchestrion.aws_sdk';

export const ATTR_RPC_SYSTEM = 'rpc.system';
export const AWS_REQUEST_ID = 'aws.request.id';
export const AWS_REQUEST_EXTENDED_ID = 'aws.request.extended_id';
