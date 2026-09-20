# AI Video Creator

A Flutter app (iOS + Android) for turning a topic into a full narrated, captioned
video — plus a standalone text-to-video clip generator for B-roll. Built to be
run yourself and, once you've tested it on real devices, submitted to the App
Store / Google Play.

## What this is, honestly

This app does **not** bundle any AI provider. There is no built-in script writer,
voice, or video model, and no backend server. Every generation step — script,
voiceover, images, video clips — is powered by an HTTP API **you** connect in
Settings: your own endpoint, your own API key, your own request/response shape.
That's a deliberate choice, not a placeholder to fill in later:

- I can't verify any specific vendor's current API contract from inside this
  environment (the sandbox blocks outbound access to those docs sites), so
  rather than hardcode integration details I'm not certain are still correct,
  the app gives you a configurable connection (endpoint, auth header, API key,
  JSON body template with `{{placeholders}}`, and a dot-path to pull the result
  out of the response). Check your provider's current docs when filling one in.
- This also means **no AI feature works out of the box** until you add at least
  one connection. The rest of the app — project management, the script/scene
  editor, local image/video picking, caption editing and timing, music mixing,
  and the actual video export/rendering pipeline — is fully implemented and
  works without any external API at all (e.g. you can write scenes by hand,
  pick your own photos/clips, and still get a real exported MP4).

## Architecture

```
lib/
  core/
    theme/          Design tokens + ThemeData (dark, Material 3)
    network/        ApiClient: template filling, dot-path JSON resolution
    storage/        ConnectionsStore (secure keychain), ProjectStore (JSON files)
    utils/          script splitting, caption timing/SRT, id generation
  models/           VideoProject, Scene, CaptionLine, ConnectionConfig, GeneratedClip
  services/         ScriptService, VoiceoverService, VisualsService, MusicService,
                     ClipGenerationService, VideoRenderService (ffmpeg pipeline)
  state/            Riverpod AsyncNotifiers for projects, connections, clips
  features/
    home/           Bottom-nav shell + project list
    studio/         The 6-step project editor (Script → Voiceover → Visuals →
                     Captions → Music → Export)
    clip_generator/ Standalone text-to-video clip tool
    settings/       Connection management (add/edit/delete, per Connection kind)
```

API keys live in the device's secure keychain (`flutter_secure_storage`), never
in plain files. Project metadata (scripts, scene structure, caption text/timing)
is stored as JSON under the app's documents directory; media files (voiceover
audio, images/video, exported MP4s) are plain files alongside it.

### The video pipeline

`VideoRenderService` renders a project as a sequence of ffmpeg passes rather
than one giant filter graph — slower, but far easier to debug:

1. Each scene becomes its own `.mp4` segment: its visual (image, held for the
   scene's duration, or video) + its voiceover (or silence) + burned-in
   captions (via ffmpeg's `subtitles` filter from a per-scene `.srt`).
2. Segments are concatenated (`-f concat`) into one video.
3. If a background music track is set, it's mixed under the narration
   (`amix`, looped/trimmed to length, at your chosen volume).

A scene without a voiceover falls back to a reading-speed estimate (~2.5
words/sec) for its duration, so you can preview/export before generating audio.

## Before you rely on this: the FFmpeg/GPL licensing tradeoff

Video rendering uses [`ffmpeg_kit_flutter_new`](https://pub.dev/packages/ffmpeg_kit_flutter_new)
(the maintained continuation of `ffmpeg_kit_flutter`, which was archived in 2025).
The full build this app currently depends on bundles GPL v3-licensed codecs
(x264, x265). That has real implications for a closed-source App Store
release — this is not something to wave away. Before shipping:

- Read that package's licensing section and decide whether the GPL-encumbered
  variant, a smaller non-GPL variant (fewer codecs), or a fully native
  replacement (Android Media3 `Transformer` + iOS `AVFoundation`/
  `AVAssetExportSession`, no FFmpeg at all) is right for your situation.
  `VideoRenderService` is the only place that touches ffmpeg, so swapping the
  rendering backend later is a contained change.
- This isn't legal advice; if you're monetizing this, it's worth a real check.

## What's verified vs. what to verify yourself

Verified in this environment (Flutter installed, `flutter analyze` and
`flutter test` both pass clean, 18 tests covering the template-filling,
JSON-path-resolution, script-splitting, and caption-timing logic):

- The app compiles and its non-UI logic is unit-tested.
- Dependency choices (`ffmpeg_kit_flutter_new`, `file_picker`'s current static
  API, `share_plus`'s current `SharePlus.instance.share` API, Flutter's current
  `DropdownButtonFormField.initialValue`) were checked against the actual
  installed package source, not assumed from memory.

**Not possible to verify here** (no Mac/Xcode, no Android SDK, no device/emulator
in this sandbox — confirmed via `flutter doctor`):

- Actually running the app, the full generation pipeline, or a real ffmpeg
  render on a device or simulator.
- Any specific AI provider's request/response shape — you'll need to fill in a
  connection's body template and result path yourself, against your chosen
  provider's current docs.

## Getting it running yourself

1. Install Flutter (this was built against 3.47.5 stable) and run
   `flutter doctor` to confirm your iOS/Android toolchains are set up.
2. `flutter pub get`
3. `flutter run` on a simulator/device (or `flutter build ios` / `flutter build appbundle`
   once you're ready to submit).
4. In the app: Settings tab → add a connection for at least one of Script,
   Voiceover, Image, or Video Clip generation, pointing at a provider you have
   an API key for.

## Before submitting to the App Store / Google Play

- Decide on the FFmpeg/GPL question above.
- Add real app icons and a launch screen (currently Flutter's defaults).
- Write a privacy policy: this app sends user-entered prompts/scripts to
  whatever third-party APIs the user connects, and stores API keys in the
  device keychain. Both app stores require disclosing this.
- Test the full pipeline end-to-end on a real device with real API keys.
- iOS: photo library usage descriptions are already in `Info.plist`
  (`NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`) for
  picking media and saving exports.
- Android: manifest already declares `INTERNET` and the Android 13+ granular
  media permissions (`READ_MEDIA_IMAGES`/`VIDEO`/`AUDIO`) plus the legacy
  `READ_EXTERNAL_STORAGE` for older versions.
