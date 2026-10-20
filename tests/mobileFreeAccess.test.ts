import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const readMobile = (file: string) => readFile(new URL(`../mobile/${file}`, import.meta.url), 'utf8');

describe('free mobile app', () => {
  it('ships no ad SDK, mediation plugin, ad identifiers, or ad-only network exception', async () => {
    const config = JSON.parse(await readMobile('app.json'));
    const manifest = JSON.parse(await readMobile('package.json'));
    const lock = JSON.parse(await readMobile('package-lock.json'));

    expect(manifest.dependencies['ironsource-mediation']).toBeUndefined();
    expect(manifest.dependencies['react-native-google-mobile-ads']).toBeUndefined();
    expect(lock.packages['node_modules/ironsource-mediation']).toBeUndefined();
    expect(config.expo.plugins).not.toContain('./plugins/withLevelPlayMediation');
    expect(config.expo.ios.infoPlist.SKAdNetworkItems).toBeUndefined();
    expect(config.expo.ios.infoPlist.NSAppTransportSecurity).toBeUndefined();
  });

  it('keeps export delivery and results without requesting or showing ads', async () => {
    const app = await readMobile('App.tsx');
    expect(app).toContain('await exportTimeline(');
    expect(app).toContain('await deliverExport(rendered.uri)');
    expect(app).toContain('setExportState(');
    expect(app).not.toMatch(/AdBanner|prepareExportAd|showExportAd|LevelPlay/);
  });

  it('explains free access and provider costs without advertising controls', async () => {
    const settings = await readMobile('src/screens/SettingsScreen.tsx');
    expect(settings).toContain('OpenScene is free, with no subscription, paid tier, or ads.');
    expect(settings).toContain('charges on your own provider account');
    expect(settings).not.toMatch(/openAdTestSuite|Ad mediation|Ads pay for it/);
  });

  it('retains the published contact and privacy links', async () => {
    const about = await readMobile('src/lib/about.ts');
    const settings = await readMobile('src/screens/SettingsScreen.tsx');
    expect(about).toContain("PRIVACY_URL = 'https://www.sloki9637.com/privacy'");
    expect(about).toContain("TERMS_URL = 'https://www.sloki9637.com/terms'");
    expect(settings).toContain('WebBrowser.openBrowserAsync(PRIVACY_URL)');
    expect(settings).toContain('WebBrowser.openBrowserAsync(TERMS_URL)');
  });
});
