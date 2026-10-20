# Releasing OpenScene to the stores

What the repository already sets, and what only you can.

Identity is fixed in `app.json` and regenerates from it — `android/` and `ios/`
are build output, not source, so never edit them by hand. Anything that must
survive `expo prebuild` belongs in a config plugin, as the release signing does.

| | value |
| --- | --- |
| Display name | OpenScene |
| iOS bundle id / Android applicationId | `com.sloki9637.openscene` |
| Version | `0.10.0` (`expo.version`) |
| iOS build number | `expo.ios.buildNumber` |
| Android version code | `expo.android.versionCode` |

Both stores reject a build whose build number is not higher than the last one
you uploaded, **even for a rejected submission**. Raise `buildNumber` and
`versionCode` on every upload, not on every release.

## Permissions

The app asks for three, and the manifest is pruned to exactly those:

- `INTERNET` — generation calls the providers you connected
- `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED` — importing a clip

`RECORD_AUDIO`, `VIBRATE`, `SYSTEM_ALERT_WINDOW`, the image and audio media
permissions and legacy external storage all arrive from transitive libraries and
are removed in `expo.android.blockedPermissions`. Reviewers ask about
permissions an app does not visibly use, and every extra one is another row to
justify in Data Safety.

## Android

### The signing key is yours to make

Play requires a real key, and the repository holds no secrets. Generate one and
keep it somewhere you will still have in five years — losing it means you cannot
update the listing:

```bash
keytool -genkeypair -v -keystore openscene-release.jks \
  -alias openscene -keyalg RSA -keysize 2048 -validity 10000
```

Then put the four values in `~/.gradle/gradle.properties` — outside the
repository, and never in it:

```properties
OPENSCENE_STORE_FILE=/absolute/path/to/openscene-release.jks
OPENSCENE_STORE_PASSWORD=…
OPENSCENE_KEY_ALIAS=openscene
OPENSCENE_KEY_PASSWORD=…
```

`plugins/withReleaseSigning.js` reads them. When they are absent the release
build falls back to the debug key, so a local build still works for testing and
only a real submission needs the keystore.

## Store distribution on main releases

The **release** workflow is the only store-distribution trigger. It runs when
an unreleased version is promoted to `main`, after the release verification and
desktop packaging jobs finish. It calls the iOS and Android distribution
workflows; they cannot be run manually. A push to `main` with an already tagged
version skips all release and store-distribution work.

The iOS job builds an IPA and uploads it to App Store Connect. It never submits
an app for review: that remains an explicit App Store Connect action after build
processing and metadata review. The Android job uploads the signed AAB to the
Google Play **production** track with status `completed`. When the
`GOOGLE_PLAY_CHANGES_NOT_SENT_FOR_REVIEW` environment variable is `true`, the
edit is committed but needs **Send for review** in Play Console's Publishing
overview. The update is not live merely because the workflow passed. If managed
publishing is enabled, publish the approved changes there too.

**The Android job runs after the iOS one, not beside it.** An iOS failure must
not leave a Play edit committed without a release record. Previously the Play
upload could go live while iOS failed, leaving the release untagged and a later
push to `main` unable to reuse the same `versionCode`.

One smaller gap remains, which ordering cannot close. If Play commits and the
tagging job then fails, the edit is pending review and unrecorded as a GitHub
release. Re-running the workflow is safe for the tag — it asks origin before
pushing — but it re-enters the store jobs. Raise `buildNumber` and `versionCode`
before another upload; if the version was already tagged, raise `version` too.

Create the `app-store-production` GitHub Environment and restrict it to the `main`
branch. It has no required-reviewer gate: once a new `main` release reaches this
environment, the App Store upload runs automatically. Store the following values as
environment configuration (not in the repository):

- Variable: `APPLE_TEAM_ID` (`5H9F8F82WT`). `APP_STORE_PROFILE_NAME` is no
  longer required — the workflow reads the name out of the profile it installs,
  so rotating the profile is a one-secret operation. If the variable is still set
  and disagrees, the build warns and signs with the installed profile anyway.
- Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`,
  `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`,
  `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`, and
  `APP_STORE_PROVISIONING_PROFILE_BASE64`.

`ASC_PRIVATE_KEY` is the complete content of the downloaded App Store Connect
`.p8` file. The two `*_BASE64` secrets are base64-encoded copies of the signing
certificate `.p12` and the App Store provisioning profile respectively. Never
commit any of these files or their decoded values.

### Google Play automation

Create the `play-store-production` GitHub Environment and restrict it to the
`main` branch. It has no required-reviewer gate: once the release workflow reaches
this environment, the Play production upload runs automatically. Store the following
values as environment configuration (not in the repository):

- Variable: `ANDROID_PACKAGE_NAME` (`com.sloki9637.openscene`).
- Variable: `GOOGLE_PLAY_CHANGES_NOT_SENT_FOR_REVIEW` (`true` when Play requires
  manual review submission; otherwise `false` or unset). For the v0.10.0
  recovery this must be `true` because Play rejected automatic submission.
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.

`ANDROID_KEYSTORE_BASE64` is the base64-encoded release keystore. The Google
Play service account must have access to the OpenScene app in Play Console and
the Google Play Android Developer API must be enabled for its Google Cloud
project. Never commit the keystore, Gradle properties, or service-account JSON.

### Build

```bash
cd mobile
npx expo prebuild --platform android
cd android && ./gradlew bundleRelease
```

The AAB lands in `android/app/build/outputs/bundle/release/`. Play takes an
**AAB**, not an APK; `assembleRelease` produces an APK, which is for sideloading
and direct distribution.

## iOS

Needs an Apple Developer account, a distribution certificate and a provisioning
profile for `com.sloki9637.openscene` — all created in your own account, none of
which this repository can or should hold.

```bash
cd mobile
npx expo prebuild --platform ios
open ios/OpenScene.xcworkspace
```

Then Product → Archive → Distribute App. `ITSAppUsesNonExemptEncryption` is
already declared `false`, which skips the export-compliance question on every
upload — correct here because the app uses only standard TLS and the system
keychain. Verify that claim yourself before you rely on it; it is a legal
declaration in your name, not ours.

## What reviewers will ask about

**The app talks to third-party AI providers.** Only ones the user connects with
their own key, only when they ask, and the key is held in Keychain/Keystore.
Both stores want that stated in the privacy questionnaire and in the privacy
policy, which is published at `https://www.sloki9637.com/privacy` and linked from
Settings. Prompts and generated media go to the provider the user chose; nothing
else about the user's editing leaves the device, and there is no account.

**The app reports anonymous usage counts.** They go to the publisher's own
OpenPanel instance at `panel.sanhouse.kr`, not to a third party, and there is no
account or profile to attach them to — the only identifier is the device-scoped
anonymous one the SDK keeps. Data Safety and App Privacy still have to say so:
declare app interactions / diagnostics, collected by the developer, used for
analytics, not linked to identity and not used for tracking. It is on by default
with a switch in Settings, so it is disclosed rather than consented to; if this
app ever needs GDPR consent for it, it belongs behind a consent flow of its own.
What is sent is bounded by
`src/lib/analytics.ts` — a closed list of event names and property values that
can only be numbers, booleans or null, which is why no prompt, file name, path or
key can reach it.

**The new mobile build is ad-free.** Unity LevelPlay and its mediated networks,
app keys, ad units, SKAdNetwork identifiers, and the ad-only App Transport Security
exception were removed. Before publishing this build, change the Play Console
“Contains ads” answer to **No** and update the App Store and Play privacy answers
so they describe the new binary. Remove advertising identifiers and advertising
purposes only if no other included SDK requires them. The already-published
privacy policy must also stop claiming OpenScene serves ads; repository changes
do not update that external page. Confirm the current policy still covers provider
requests and optional anonymous usage reporting.

There is no app subscription or paid tier. AI providers may charge the user’s own
account for generation, and the in-app spend permissions still apply. Check that
store pricing and subscription products reflect the free app separately from
this source change. Existing builds can continue to display ads until replaced
through the stores, so review the shipped build and listing together.

**Android export has a real-device preflight for 0.9.0.** The publisher confirmed
that a clip exports to a playable file on a real Android device. Repeat that
check after changing the Media3 export path. If it fails, set `isSupported` back
to `false` in `VideoExportModule.kt` so the app says so plainly.

Overlapping video layers are composited now rather than refused: the plan says
which layer a segment belongs to and Android builds one Media3 sequence per
layer. The publisher also confirmed an export with two overlapping video tracks
on a real Android device before 0.9.0. Repeat this case after changing the
layered export path.

**Age rating** — user-supplied prompts reach a generative model, so both stores
treat it as user-generated content. Expect questions about moderation; the
honest answer is that moderation is the provider's, since the app holds no
server of its own.
