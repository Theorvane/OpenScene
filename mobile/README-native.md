# Running with the native export module

`mobile/modules/video-export` is a local Expo module. Expo Go cannot load it — it only carries the modules baked into its own binary — so export is disabled there, with the reason shown on screen. To exercise it you need a development build.

The native module renders the shared timeline after Canvas output has been applied. iOS uses AVFoundation and Android uses Media3. The editing agent's export tool uses the same native path and user-controlled Photos/share delivery.

## iOS development build

```bash
cd mobile
npx expo prebuild --platform ios
cd ios && LANG=en_US.UTF-8 pod install
cd .. && npx expo run:ios
```

## The locale is not optional

`pod install` fails with

```
Unicode Normalization not appropriate for ASCII-8BIT (Encoding::CompatibilityError)
```

when `LANG` and `LC_ALL` are unset. CocoaPods calls `unicode_normalize` on the installation path, and without a UTF-8 locale that path is `ASCII-8BIT`. This machine had both unset, so `expo prebuild` appeared to succeed while its `pod install` step had died. Setting `LANG=en_US.UTF-8` is the whole fix.

## Confirming the module is linked

`ios/Podfile.lock` should contain:

```
- VideoExport (1.0.0)
- VideoExport (from `../modules/video-export/ios`)
```

and the editor's export note should read "Export renders with AVFoundation" rather than "Export needs a development build". That note is driven by `requireOptionalNativeModule`, so it is a direct report of whether the native side resolved.

`ios/` and `android/` are gitignored, as Expo's continuous-native-generation flow expects — they are regenerated from config and never edited by hand.

## Android development build

With the Android SDK, configured emulator or development device available:

```bash
cd mobile
npx expo prebuild --platform android
npx expo run:android
```

## Verify an editing workflow

Import real media, build a quick start or connect blocks, apply the final output and check it in Edit. Verify native export completes and the file can be saved/played. Exercise speed, delay, overlapping layers, audio mixing and title typography on the target device after changes to those paths. Test agent approval separately from rendering.

Node tests and mobile typecheck establish shared rules and compilation, not native visual/audio behavior. Record the device and build with observed results. See [workflow acceptance checks](../docs/canvas-export-verification.md).
