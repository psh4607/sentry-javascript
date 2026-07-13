// EXPERIMENTAL — Vite plugin that runs the orchestrion code transform at build
// time, injecting `diagnostics_channel.tracingChannel` calls into the libraries
// listed in `SENTRY_INSTRUMENTATIONS`.
//
// This file is published ESM-only via the `@sentry/server-utils/orchestrion/vite`
// subpath export. `@apm-js-collab/code-transformer-bundler-plugins` is
// `"type": "module"`, so consuming it from a CJS build is intentionally
// unsupported — vite.config.ts is almost always ESM in practice. The CJS
// rollup variant still emits this file, but `package.json` only exposes the
// ESM entry, so attempts to `require('@sentry/server-utils/orchestrion/vite')` will
// fail at resolution time rather than producing a half-broken plugin.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnknownPlugin = any;

import codeTransformer from '@apm-js-collab/code-transformer-bundler-plugins/vite';
import MagicString from 'magic-string';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { INSTRUMENTED_MODULE_NAMES, SENTRY_INSTRUMENTATIONS } from '../config';

// `vite` types live in the package's ESM-only subpath; under Node16 module
// resolution with TS treating @sentry/server-utils as CJS, importing them produces a
// false positive. We don't need the runtime value for typing — `UnknownPlugin`
// is sufficient — so we omit the import entirely.

export interface SentryOrchestrionPluginOptions {
  /**
   * Whether to register the SDK's channel-subscriber integrations at build time.
   *
   * When `true`, the plugin injects into the app's server entry a static import
   * that registers the channel-subscriber integrations on the global orchestrion
   * marker, where `getRegisteredChannelIntegrations()` picks them up. This is how
   * the subscriber integrations — which SDKs deliberately do not import so
   * bundlers can drop them — end up in the bundle exactly when this plugin
   * injects the channels they subscribe to.
   *
   * The registration is SDK-agnostic: the injected import targets
   * `@sentry/server-utils` (a transitive dependency of every SDK that uses this
   * plugin), so any bundled SDK — Cloudflare today, Nuxt/Nitro, SvelteKit, Node
   * SSR later — enables it the same way, with nothing to publish or wire up.
   *
   * Leave unset for SDKs that register integrations through the runtime
   * `--import` hook instead (e.g. `@sentry/node`), which read them from a static
   * import rather than the marker.
   */
  registerIntegrations?: boolean;
}

/**
 * Vite plugin that runs the orchestrion code transform on the bundled output.
 *
 * Use when bundling a Node app with Vite (e.g. Vite SSR builds, Nuxt's Nitro
 * pipeline, SvelteKit). For unbundled Node processes use the runtime hook
 * instead (`node --import @sentry/node/orchestrion app.js`).
 *
 * Returns the following plugins:
 *   1. `sentry-orchestrion-marker` — a `renderChunk` hook that prepends a
 *      single-line banner to entry chunks. The banner sets
 *      `globalThis.__SENTRY_ORCHESTRION__.bundler = true` at app boot, so the
 *      `_experimentalSetupOrchestrion()` detector can confirm the bundler path
 *      ran (rather than relying on a build-time flag that wouldn't be visible
 *      to the runtime).
 *      Also injects every instrumented package name into `ssr.noExternal` via
 *      the `config` hook, since externalized deps are `require()`d at runtime
 *      from `node_modules` and never pass through the transform.
 *   2. `sentry-orchestrion-register-integrations` (only with
 *      `options.registerIntegrations`) — injects the channel-integration
 *      registration import into the app's server entry, see
 *      {@link SentryOrchestrionPluginOptions.registerIntegrations}.
 *   3. The upstream `@apm-js-collab/code-transformer-bundler-plugins/vite`
 *      plugin, fed our central `SENTRY_INSTRUMENTATIONS` config.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { sentryOrchestrionPlugin } from '@sentry/node/orchestrion/vite';
 * export default { plugins: [sentryOrchestrionPlugin()] };
 * ```
 */
export function sentryOrchestrionPlugin(options: SentryOrchestrionPluginOptions = {}): UnknownPlugin[] {
  const codeTransformerPlugins = codeTransformer({ instrumentations: SENTRY_INSTRUMENTATIONS });
  const codeTransformerArray: UnknownPlugin[] = Array.isArray(codeTransformerPlugins)
    ? codeTransformerPlugins
    : [codeTransformerPlugins];
  return [
    bundlerMarkerPlugin(),
    ...(options.registerIntegrations ? [registerIntegrationsPlugin()] : []),
    ...codeTransformerArray,
  ];
}

// The virtual registration module the plugin injects also acts as the sentinel
// which prevents duplicate injection.
const REGISTER_MODULE_ID = 'virtual:@sentry/orchestrion-register-integrations';
const RESOLVED_REGISTER_MODULE_ID = `\0${REGISTER_MODULE_ID}`;

/**
 * Injects, into the app's server entry, a static import that registers the
 * channel-subscriber integrations on the global orchestrion marker (where the
 * SDK's `getRegisteredChannelIntegrations()` reads them).
 *
 * Two things make this work where the obvious approaches don't:
 *
 *   - The import is added in the `transform` (module-graph) phase, NOT via the
 *     code transformer's `injectDiagnostics` hook. That hook runs at
 *     `renderChunk`, after the graph is bundled, so a bare import it adds is
 *     never bundled and workerd throws `No such module` at runtime.
 *
 *   - The virtual module imports an absolute ESM path computed at plugin init
 *     (via `createRequire`, from the plugin's own package). The entry it's
 *     injected into can itself be a virtual module (e.g.
 *     `@cloudflare/vite-plugin`'s `virtual:cloudflare/worker-entry`) with no base
 *     directory, and the worker environment's resolver won't resolve a bare
 *     specifier from there. Resolving the ESM build explicitly also avoids
 *     pulling a second, CommonJS copy of `@sentry/core` into the worker bundle.
 *
 * Registers every integration for now; the code transformer's post-bundle
 * `transformedModules` list can't drive a bundled (tree-shaken) import, so
 * per-module selection waits on a module-graph-phase hook upstream.
 */
function registerIntegrationsPlugin(): UnknownPlugin {
  // `createRequire().resolve(REGISTER_MODULE)` would select the package's CJS
  // export. Resolve the package root instead and explicitly target the ESM
  // export which is bundled alongside the ESM-only Vite plugin.
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve('@sentry/server-utils/package.json'));
  const resolvedRegisterModule = resolve(packageRoot, 'build/esm/orchestrion/index.js');

  // The slices of Vite's environment-API / Rollup plugin context we read; typed
  // structurally since we don't import `vite`/`rollup` types here (see note at
  // the top of the file).
  interface PluginContext {
    environment?: { config?: { consumer?: string } };
    getModuleInfo?: (id: string) => { isEntry?: boolean } | null;
  }

  return {
    name: 'sentry-orchestrion-register-integrations',
    resolveId(id: string): string | null {
      return id === REGISTER_MODULE_ID ? RESOLVED_REGISTER_MODULE_ID : null;
    },
    load(id: string): { code: string; moduleSideEffects: boolean } | null {
      if (id !== RESOLVED_REGISTER_MODULE_ID) return null;
      // Keep this generated rather than moving the side effect into a published
      // entry point: a future allow-list can emit only the requested factory
      // imports here and let Rollup tree-shake the rest of the ESM module.
      return {
        code: [
          `import { registerChannelIntegrations } from ${JSON.stringify(resolvedRegisterModule)};`,
          'registerChannelIntegrations();',
          '',
        ].join('\n'),
        moduleSideEffects: true,
      };
    },
    transform(this: PluginContext | undefined, code: string, id: string): { code: string; map: unknown } | null {
      // Client bundles must never pull in a server SDK's integrations; without
      // environment info (classic non-environment-API Vite) assume server.
      if (this?.environment?.config?.consumer === 'client') return null;
      // Inject into the app entry only. It must be the first module request so
      // registration runs before an entry body or a re-exported worker module
      // can initialize Sentry.
      if (!this?.getModuleInfo?.(id)?.isEntry) return null;
      if (code.includes(REGISTER_MODULE_ID)) return null;
      const ms = new MagicString(code);
      const injection = `import ${JSON.stringify(REGISTER_MODULE_ID)};\n`;
      const shebangEnd = code.startsWith('#!') ? code.indexOf('\n') : -1;
      if (code.startsWith('#!') && shebangEnd === -1) {
        ms.append(`\n${injection}`);
      } else {
        ms.appendLeft(shebangEnd + 1, injection);
      }
      return { code: ms.toString(), map: ms.generateMap({ hires: true }) };
    },
  };
}

function bundlerMarkerPlugin(): UnknownPlugin {
  const banner = [
    'globalThis.__SENTRY_ORCHESTRION__ = (globalThis.__SENTRY_ORCHESTRION__ || {});',
    'globalThis.__SENTRY_ORCHESTRION__.bundler = true;',
    '',
  ].join('\n');

  return {
    name: 'sentry-orchestrion-marker',
    enforce: 'pre' as const,
    config(): { ssr: { noExternal: string[] } } {
      // Force-bundle every instrumented package so the code transform actually
      // sees its source. Vite externalizes dependencies in SSR builds by
      // default, leaving them as bare `require()`/`import` calls resolved from
      // `node_modules` at runtime — those copies are untouched and the
      // diagnostics_channel calls never get injected. Vite merges array
      // `noExternal` entries with the user's config, so we don't overwrite
      // their additions.
      return { ssr: { noExternal: INSTRUMENTED_MODULE_NAMES } };
    },
    renderChunk(code: string, chunk: { isEntry: boolean }): { code: string; map: unknown } | null {
      if (!chunk.isEntry) return null;
      // Prepend via magic-string so the entry chunk's sourcemap stays aligned —
      // returning `map: null` here would shift every mapping by the banner's
      // line count and misattribute server stack traces.
      const ms = new MagicString(code);
      ms.prepend(banner);
      return { code: ms.toString(), map: ms.generateMap({ hires: true }) };
    },
  };
}
