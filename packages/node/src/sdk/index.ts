import type { Integration, Options } from '@sentry/core';
import { applySdkMetadata, hasSpansEnabled } from '@sentry/core';
import type { NodeClient } from '@sentry/node-core';
import {
  getDefaultIntegrations as getNodeCoreDefaultIntegrations,
  init as initNodeCore,
  validateOpenTelemetrySetup,
} from '@sentry/node-core';
import { httpIntegration } from '../integrations/http';
import { nativeNodeFetchIntegration } from '../integrations/node-fetch';
import { getAutoPerformanceIntegrations } from '../integrations/tracing';
import type { NodeOptions } from '../types';
import {
  isDiagnosticsChannelInjectionEnabled,
  resolveDiagnosticsChannelInjection,
} from './diagnosticsChannelInjection';
import { initOpenTelemetry } from './initOtel';

/**
 * Get default integrations, excluding performance.
 */
export function getDefaultIntegrationsWithoutPerformance(): Integration[] {
  const nodeCoreIntegrations = getNodeCoreDefaultIntegrations();

  // Filter out the node-core HTTP and NodeFetch integrations and replace them with Node SDK's composite versions
  return nodeCoreIntegrations
    .filter(integration => integration.name !== 'Http' && integration.name !== 'NodeFetch')
    .concat(httpIntegration(), nativeNodeFetchIntegration());
}

/** Get the default integrations for the Node SDK. */
export function getDefaultIntegrations(options: Options): Integration[] {
  const integrations: Integration[] = [
    ...getDefaultIntegrationsWithoutPerformance(),
    // We only add performance integrations if tracing is enabled
    // Note that this means that without tracing enabled, e.g. `expressIntegration()` will not be added
    // This means that generally request isolation will work (because that is done by httpIntegration)
    // But `transactionName` will not be set automatically
    ...(hasSpansEnabled(options) ? getAutoPerformanceIntegrations() : []),
  ];

  return applyDiagnosticsChannelInjectionIntegrations(integrations, options);
}

/**
 * When the app opted into diagnostics-channel injection (via
 * `experimentalUseDiagnosticsChannelInjection()`) AND span recording is enabled, drop the OTel
 * integrations that have a channel-based replacement and append the FULL channel-integration set,
 * so the two never both instrument the same library. Otherwise returns `integrations` unchanged.
 *
 * Note the asymmetry: appended channel integrations are not limited to ones whose OTel counterpart
 * was in `integrations`. For `@sentry/node` that makes no difference (the incoming list carries the
 * whole OTel performance set), but a caller with a narrower list (e.g. `@sentry/aws-serverless`)
 * gains channel coverage for libraries it never shipped OTel integrations for. Channel integrations
 * produce nothing but spans, so this is gated on span recording. Exported so SDKs that build their
 * own default-integration set can apply the same logic instead of duplicating it.
 */
export function applyDiagnosticsChannelInjectionIntegrations(
  integrations: Integration[],
  options: Options,
): Integration[] {
  if (isDiagnosticsChannelInjectionEnabled() && hasSpansEnabled(options)) {
    const diagnosticsChannelInjection = resolveDiagnosticsChannelInjection();
    if (diagnosticsChannelInjection) {
      const replaced = new Set(diagnosticsChannelInjection.replacedOtelIntegrationNames);
      return [...integrations.filter(i => !replaced.has(i.name)), ...diagnosticsChannelInjection.integrations];
    }
  }
  return integrations;
}

/**
 * Initialize Sentry for Node.
 */
export function init(options: NodeOptions | undefined = {}): NodeClient | undefined {
  return _init(options, getDefaultIntegrations);
}

/**
 * Internal initialization function.
 */
function _init(
  options: NodeOptions | undefined = {},
  getDefaultIntegrationsImpl: (options: Options) => Integration[],
): NodeClient | undefined {
  applySdkMetadata(options, 'node');

  // EXPERIMENTAL: diagnostics-channel injection, opted into via
  // `experimentalUseDiagnosticsChannelInjection()`. Gated on span recording to
  // match the OTel integrations it replaces. With tracing off there are no
  // channel subscribers, so injecting is pointless work. `resolve...()` is
  // memoized, so `getDefaultIntegrations()` (below) sees the same instance.
  const diagnosticsChannelInjection =
    isDiagnosticsChannelInjectionEnabled() && hasSpansEnabled(options)
      ? resolveDiagnosticsChannelInjection()
      : undefined;

  // Install the channel-injection hooks as early as possible, before the app
  // imports its instrumented modules.
  if (diagnosticsChannelInjection) {
    diagnosticsChannelInjection.register();
  }

  const client = initNodeCore({
    ...options,
    // Only use Node SDK defaults if none provided
    defaultIntegrations: options.defaultIntegrations ?? getDefaultIntegrationsImpl(options),
  });

  // Add Node SDK specific OpenTelemetry setup
  if (client && !options.skipOpenTelemetrySetup) {
    initOpenTelemetry(client, {
      spanProcessors: options.openTelemetrySpanProcessors,
    });
    validateOpenTelemetrySetup();
  }

  // Warn about missing or doubled channel injection. Runs after the client
  // is created so the debug logger is enabled and the warning is emitted.
  if (diagnosticsChannelInjection) {
    diagnosticsChannelInjection.detect();
  }

  return client;
}

/**
 * Initialize Sentry for Node, without any integrations added by default.
 */
export function initWithoutDefaultIntegrations(options: NodeOptions | undefined = {}): NodeClient | undefined {
  return _init(options, () => []);
}
