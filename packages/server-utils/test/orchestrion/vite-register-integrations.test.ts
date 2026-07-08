import { describe, expect, it } from 'vitest';
import { sentryOrchestrionPlugin } from '../../src/orchestrion/bundler/vite';

const REGISTER_MODULE_ID = 'virtual:@sentry/orchestrion-register-integrations';
const RESOLVED_REGISTER_MODULE_ID = `\0${REGISTER_MODULE_ID}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRegisterPlugin(plugins: any[]): any {
  return plugins.find(p => p.name === 'sentry-orchestrion-register-integrations');
}

// A Vite/Rollup plugin `this` context that reports `id` as an entry (or not),
// optionally in a given environment consumer ('client' | 'server').
function ctx({ isEntry = true, consumer }: { isEntry?: boolean; consumer?: string } = {}): unknown {
  return {
    getModuleInfo: () => ({ isEntry }),
    ...(consumer ? { environment: { config: { consumer } } } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runTransform(plugin: any, code: string, context: unknown = ctx()): { code: string; map: unknown } | null {
  return plugin.transform.call(context, code, 'entry.js');
}

describe('sentryOrchestrionPlugin — registerIntegrations', () => {
  it('omits the register plugin by default', () => {
    expect(getRegisterPlugin(sentryOrchestrionPlugin())).toBeUndefined();
  });

  it('omits the register plugin when registerIntegrations is false', () => {
    expect(getRegisterPlugin(sentryOrchestrionPlugin({ registerIntegrations: false }))).toBeUndefined();
  });

  it('includes the register plugin when registerIntegrations is true', () => {
    expect(getRegisterPlugin(sentryOrchestrionPlugin({ registerIntegrations: true }))).toBeDefined();
  });

  describe('virtual registration module', () => {
    const plugin = getRegisterPlugin(sentryOrchestrionPlugin({ registerIntegrations: true }));

    it('resolves the virtual id to the synthetic (\\0-prefixed) id', () => {
      expect(plugin.resolveId(REGISTER_MODULE_ID)).toBe(RESOLVED_REGISTER_MODULE_ID);
    });

    it('does not resolve unrelated ids', () => {
      expect(plugin.resolveId('some-other-module')).toBeNull();
    });

    it('loads a module that registers the channel integrations, kept as a side effect', () => {
      const result = plugin.load(RESOLVED_REGISTER_MODULE_ID);

      expect(result?.code).toContain("from '@sentry/server-utils/orchestrion'");
      expect(result?.code).toContain('registerChannelIntegrations()');
      expect(result?.moduleSideEffects).toBe(true);
    });

    it('does not reference any specific SDK package (SDK-agnostic)', () => {
      expect(plugin.load(RESOLVED_REGISTER_MODULE_ID)?.code).not.toContain('@sentry/cloudflare');
    });

    it('does not load unrelated ids', () => {
      expect(plugin.load('some-other-module')).toBeNull();
    });
  });

  describe('transform', () => {
    const plugin = getRegisterPlugin(sentryOrchestrionPlugin({ registerIntegrations: true }));

    it('injects the virtual registration import into the entry module', () => {
      const result = runTransform(plugin, 'export default {};\n', ctx({ isEntry: true }));

      expect(result?.code).toContain(`import "${REGISTER_MODULE_ID}";`);
      expect(result?.map).toBeTruthy();
    });

    it('injects into a re-export entry that never names the SDK', () => {
      const result = runTransform(plugin, `export { default } from './worker';\n`, ctx({ isEntry: true }));

      expect(result?.code).toContain(`import "${REGISTER_MODULE_ID}";`);
    });

    it('does not inject into non-entry modules', () => {
      const code = `import * as Sentry from '@sentry/cloudflare';\nSentry.startSpan({}, () => {});\n`;
      expect(runTransform(plugin, code, ctx({ isEntry: false }))).toBeNull();
    });

    it('does not double-inject when the virtual module is already imported', () => {
      const code = `export default {};\nimport "${REGISTER_MODULE_ID}";\n`;
      expect(runTransform(plugin, code, ctx({ isEntry: true }))).toBeNull();
    });

    it('does not inject into client-environment entries', () => {
      expect(runTransform(plugin, 'export default {};\n', ctx({ isEntry: true, consumer: 'client' }))).toBeNull();
    });

    it('injects into server-environment entries', () => {
      const result = runTransform(plugin, 'export default {};\n', ctx({ isEntry: true, consumer: 'server' }));

      expect(result?.code).toContain(`import "${REGISTER_MODULE_ID}";`);
    });

    it('assumes server when no environment info is available (classic Vite)', () => {
      const noEnvCtx = { getModuleInfo: () => ({ isEntry: true }) };
      const result = runTransform(plugin, 'export default {};\n', noEnvCtx);

      expect(result?.code).toContain(`import "${REGISTER_MODULE_ID}";`);
    });
  });
});
