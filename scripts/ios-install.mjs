// Builds the standalone phone app and installs it on a connected iPhone.
//   npm run ios:install            (first connected iPhone)
//   IOS_DEVICE=<udid> npm run ios:install
// Needs: Xcode signed in with an Apple ID (Settings > Accounts), the iPhone unlocked,
// trusted and in Developer Mode, connected by cable or on the same network.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

function findIphone() {
  const out = join(mkdtempSync(join(tmpdir(), 'msk-devices-')), 'devices.json');
  execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', out], { stdio: 'ignore' });
  const devices = JSON.parse(readFileSync(out, 'utf8')).result.devices;
  const phones = devices.filter((d) => d.hardwareProperties?.deviceType === 'iPhone');
  const wanted = process.env.IOS_DEVICE;
  const pick = wanted
    ? phones.find((d) => d.hardwareProperties?.udid === wanted || d.identifier === wanted)
    : phones.find((d) => d.connectionProperties?.tunnelState === 'connected') ??
      phones.find((d) => d.connectionProperties?.tunnelState !== 'unavailable');
  if (!pick) {
    const seen = phones.map((d) => `${d.deviceProperties?.name} (${d.connectionProperties?.tunnelState})`).join(', ') || 'none';
    console.error(`No reachable iPhone. Seen: ${seen}.\nPlug it in with a cable, unlock it, tap "Trust" if asked, then run this again.`);
    process.exit(1);
  }
  return pick;
}

const phone = findIphone();
console.log(`Installing on ${phone.deviceProperties?.name}`);

run('npm', ['run', 'build:ios']);
const dd = join(root, 'ios', 'build');
run('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
  '-destination', 'generic/platform=iOS', '-derivedDataPath', dd,
  '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', '-quiet', 'build',
]);
const app = join(dd, 'Build', 'Products', 'Debug-iphoneos', 'App.app');
run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', phone.identifier, app]);
const bundleId = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8')).appId;
try {
  run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', phone.identifier, bundleId]);
} catch {
  console.log('\nInstalled, but it did not open automatically. Unlock the iPhone and tap "MSK Assess". If iOS says the developer is not trusted: Settings > General > VPN & Device Management, trust your developer certificate, then tap the app.');
}
