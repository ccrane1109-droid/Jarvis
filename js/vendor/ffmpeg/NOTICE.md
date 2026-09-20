# Vendored: ffmpeg.wasm

These files are the single-threaded ("core", non-multithread) build of
[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), self-hosted here
(rather than loaded from a CDN) so the AI Video Studio feature works without
depending on a third-party CDN being reachable, and so it's cached for
offline use by the app's service worker like everything else in JARVIS.

Fetched from the npm registry, unmodified:

| File | Package | Version | License |
|---|---|---|---|
| `ffmpeg.js`, `814.ffmpeg.js` | [`@ffmpeg/ffmpeg`](https://www.npmjs.com/package/@ffmpeg/ffmpeg) | 0.12.15 | MIT |
| `ffmpeg-core.js`, `ffmpeg-core.wasm` | [`@ffmpeg/core`](https://www.npmjs.com/package/@ffmpeg/core) | 0.12.10 | GPL-2.0-or-later |

`@ffmpeg/util`'s prebuilt UMD bundle isn't vendored: it references a bare
`exports` global that only exists under a bundler, so it throws when loaded
via a plain `<script>` tag. The one helper actually needed from it
(`toBlobURL`, a two-line fetch-and-createObjectURL wrapper) is implemented
directly in `js/video-studio.js` instead.

`ffmpeg-core.wasm` (~30MB) is the actual FFmpeg build compiled to
WebAssembly; it's GPL-2.0-or-later licensed. It runs entirely in the
browser and is never bundled into a compiled app binary, but if this
project is ever wrapped into a native app for distribution, revisit that
licensing question — see `ai-video-creator/README.md` for the equivalent
discussion on the native side.
