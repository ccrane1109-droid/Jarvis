import 'dart:io';

import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';

import '../core/utils/caption_builder.dart';
import '../core/utils/ids.dart';
import '../models/scene.dart';
import '../models/video_project.dart';

class RenderResult {
  final bool ok;
  final String? outputPath;
  final String? errorMessage;

  const RenderResult({required this.ok, this.outputPath, this.errorMessage});
}

class _Resolution {
  final int width;
  final int height;
  const _Resolution(this.width, this.height);
}

/// Renders a [VideoProject] to a single MP4 by compositing each scene's
/// visual + voiceover + burned-in captions into a segment, concatenating
/// the segments, then mixing in the background music track.
///
/// This is a multi-pass pipeline (several ffmpeg invocations against
/// intermediate files) rather than one giant filter graph, which is
/// slower but far easier to reason about, debug, and keep working as
/// scenes are added/changed.
///
/// Uses ffmpeg_kit_flutter_new, which bundles GPL-licensed codecs
/// (x264/x265). That has real implications for closed-source App Store
/// distribution — see the project README before shipping.
class VideoRenderService {
  Future<RenderResult> render({
    required VideoProject project,
    required Directory workDir,
    required Directory outputDir,
    void Function(String status)? onStatus,
  }) async {
    if (project.scenes.isEmpty) {
      return const RenderResult(
        ok: false,
        errorMessage: 'This project has no scenes to render.',
      );
    }
    final renderDir = Directory('${workDir.path}/render_${newId()}');
    await renderDir.create(recursive: true);
    final resolution = _resolutionFor(project.aspectRatio);
    final segmentPaths = <String>[];

    try {
      for (var i = 0; i < project.scenes.length; i++) {
        onStatus?.call('Rendering scene ${i + 1} of ${project.scenes.length}…');
        final scene = project.scenes[i];
        final segmentPath =
            '${renderDir.path}/scene_${i.toString().padLeft(3, '0')}.mp4';
        final result = await _renderScene(
          scene: scene,
          resolution: resolution,
          renderDir: renderDir,
          outputPath: segmentPath,
        );
        if (!result.ok) {
          return RenderResult(
            ok: false,
            errorMessage: 'Scene ${i + 1}: ${result.errorMessage}',
          );
        }
        segmentPaths.add(segmentPath);
      }

      onStatus?.call('Combining scenes…');
      final concatListFile = File('${renderDir.path}/concat_list.txt');
      await concatListFile.writeAsString(
        segmentPaths.map((p) => "file '${_escapeForConcatList(p)}'").join('\n'),
      );
      final concatenatedPath = '${renderDir.path}/concatenated.mp4';
      final concatCommand =
          '-y -f concat -safe 0 -i "${concatListFile.path}" -c copy "$concatenatedPath"';
      final concatOk = await _run(concatCommand);
      if (!concatOk.ok) {
        return RenderResult(
          ok: false,
          errorMessage: 'Combining scenes failed: ${concatOk.errorMessage}',
        );
      }

      String finalPath = concatenatedPath;
      if (project.musicFilePath != null &&
          project.musicFilePath!.trim().isNotEmpty) {
        onStatus?.call('Mixing background music…');
        final mixedPath = '${renderDir.path}/with_music.mp4';
        final volume = project.musicVolume.clamp(0.0, 1.0);
        final mixCommand =
            '-y -i "$concatenatedPath" -stream_loop -1 -i "${project.musicFilePath}" '
            '-filter_complex "[1:a]volume=$volume[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]" '
            '-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "$mixedPath"';
        final mixOk = await _run(mixCommand);
        if (!mixOk.ok) {
          return RenderResult(
            ok: false,
            errorMessage: 'Mixing music failed: ${mixOk.errorMessage}',
          );
        }
        finalPath = mixedPath;
      }

      onStatus?.call('Saving export…');
      await outputDir.create(recursive: true);
      final exportPath =
          '${outputDir.path}/${project.id}_${DateTime.now().millisecondsSinceEpoch}.mp4';
      await File(finalPath).copy(exportPath);
      return RenderResult(ok: true, outputPath: exportPath);
    } finally {
      if (await renderDir.exists()) {
        await renderDir.delete(recursive: true);
      }
    }
  }

  Future<RenderResult> _renderScene({
    required Scene scene,
    required _Resolution resolution,
    required Directory renderDir,
    required String outputPath,
  }) async {
    final duration = scene.effectiveDurationSeconds;
    final durationStr = duration.toStringAsFixed(2);

    String visualInput;
    String visualInputFlags;
    if (scene.visualPath != null &&
        scene.visualType == VisualSourceType.localVideo) {
      visualInput = '-stream_loop -1 -i "${scene.visualPath}"';
      visualInputFlags = '-t $durationStr';
    } else if (scene.visualPath != null) {
      visualInput = '-loop 1 -i "${scene.visualPath}"';
      visualInputFlags = '-t $durationStr';
    } else {
      visualInput =
          '-f lavfi -i "color=c=black:s=${resolution.width}x${resolution.height}:d=$durationStr"';
      visualInputFlags = '';
    }

    String audioInput;
    if (scene.voiceoverFilePath != null &&
        scene.voiceoverFilePath!.trim().isNotEmpty) {
      audioInput = '-i "${scene.voiceoverFilePath}"';
    } else {
      audioInput = '-f lavfi -i "anullsrc=r=44100:cl=stereo"';
    }

    var videoFilter =
        'scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,'
        'pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:color=black,'
        'setsar=1,fps=30';

    String? srtPath;
    if (scene.captions.isNotEmpty) {
      srtPath = '${renderDir.path}/${scene.id}.srt';
      await File(srtPath).writeAsString(captionsToSrt(scene.captions));
      videoFilter += ",subtitles='${_escapeForFilterPath(srtPath)}'";
    }

    final command =
        '-y $visualInput $visualInputFlags $audioInput '
        '-t $durationStr -vf "$videoFilter" '
        '-c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "$outputPath"';

    return _run(command);
  }

  Future<RenderResult> _run(String command) async {
    final session = await FFmpegKit.execute(command);
    final returnCode = await session.getReturnCode();
    if (ReturnCode.isSuccess(returnCode)) {
      return const RenderResult(ok: true);
    }
    final logs = await session.getAllLogsAsString();
    return RenderResult(ok: false, errorMessage: _lastLogLines(logs, 6));
  }

  String _lastLogLines(String? logs, int count) {
    if (logs == null || logs.trim().isEmpty) {
      return 'ffmpeg failed with no log output.';
    }
    final lines = logs.trim().split('\n');
    final tail = lines.length <= count
        ? lines
        : lines.sublist(lines.length - count);
    return tail.join(' | ');
  }

  _Resolution _resolutionFor(String aspectRatio) {
    switch (aspectRatio) {
      case '16:9':
        return const _Resolution(1920, 1080);
      case '1:1':
        return const _Resolution(1080, 1080);
      case '9:16':
      default:
        return const _Resolution(1080, 1920);
    }
  }

  String _escapeForConcatList(String path) => path.replaceAll("'", "'\\''");

  String _escapeForFilterPath(String path) {
    return path
        .replaceAll('\\', '\\\\')
        .replaceAll(':', '\\:')
        .replaceAll("'", "\\'");
  }
}
