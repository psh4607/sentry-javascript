import type { Span } from '@sentry/core';
import type { NormalizedRequest, NormalizedResponse, RequestMetadata } from '../types';

export type { RequestMetadata };

export interface ServiceExtension {
  // called before the request is sent, and before the span is started
  requestPreSpanHook: (request: NormalizedRequest) => RequestMetadata;

  // called before the request is sent, and after the span is started. `span` is the started span,
  // used to derive trace-propagation headers injected into outgoing messages.
  requestPostSpanHook?: (request: NormalizedRequest, span: Span) => void;

  // Called after the response is received. Unlike the OTel middleware patch, a tracing-channel
  // subscriber cannot replace the value the caller's promise resolves with (`data.result` is not
  // writable through the channel), so extensions that need to alter the response, e.g. to wrap a
  // stream, must mutate `response.data` in place.
  responseHook?: (response: NormalizedResponse, span: Span) => void;
}
