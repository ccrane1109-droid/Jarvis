import 'dart:convert';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';

import '../core/network/api_client.dart';
import '../core/utils/ids.dart';
import '../models/connection_config.dart';

class VoiceoverResult {
  final bool ok;
  final String? filePath;
  final double? durationSeconds;
  final String? errorMessage;

  const VoiceoverResult({
    required this.ok,
    this.filePath,
    this.durationSeconds,
    this.errorMessage,
  });
}

class VoiceoverService {
  final ApiClient _client;

  VoiceoverService({ApiClient? client}) : _client = client ?? ApiClient();

  Future<VoiceoverResult> synthesize({
    required ConnectionConfig connection,
    required String text,
    required Directory outputDir,
  }) async {
    final body = fillJsonTemplate(connection.bodyTemplate, {'text': text});
    final expectBinary = connection.responseKind == ResponseKind.binary;
    final result = await _client.post(
      endpointUrl: connection.endpointUrl,
      authHeaderName: connection.authHeader,
      apiKey: connection.apiKey,
      jsonBody: body,
      expectBinary: expectBinary,
    );
    if (!result.ok) {
      return VoiceoverResult(
        ok: false,
        errorMessage: result.errorMessage ?? 'Request failed.',
      );
    }

    List<int>? audioBytes;
    if (expectBinary) {
      audioBytes = result.bodyBytes;
    } else {
      final value = resolveJsonPath(
        result.decodedJson,
        connection.responsePath,
      );
      if (value is String && value.startsWith('http')) {
        final download = await _client.getBytes(value);
        if (!download.ok || download.bodyBytes == null) {
          return VoiceoverResult(
            ok: false,
            errorMessage:
                download.errorMessage ?? 'Could not download voiceover audio.',
          );
        }
        audioBytes = download.bodyBytes;
      } else if (value is String && value.isNotEmpty) {
        audioBytes = _tryDecodeBase64(value);
      }
    }

    if (audioBytes == null || audioBytes.isEmpty) {
      return const VoiceoverResult(
        ok: false,
        errorMessage: 'No audio data found in the response. Check the Connection settings.',
      );
    }

    final extension = _guessExtension(result.contentType);
    final file = File('${outputDir.path}/${newId('voiceover')}.$extension');
    await file.writeAsBytes(audioBytes);

    final duration = await _probeDuration(file.path);
    return VoiceoverResult(
      ok: true,
      filePath: file.path,
      durationSeconds: duration,
    );
  }

  List<int>? _tryDecodeBase64(String value) {
    final commaIndex = value.indexOf(',');
    final raw = value.startsWith('data:') && commaIndex != -1
        ? value.substring(commaIndex + 1)
        : value;
    try {
      return base64.decode(raw);
    } catch (_) {
      return null;
    }
  }

  String _guessExtension(String? contentType) {
    if (contentType == null) return 'mp3';
    if (contentType.contains('wav')) return 'wav';
    if (contentType.contains('ogg')) return 'ogg';
    if (contentType.contains('aac')) return 'aac';
    return 'mp3';
  }

  Future<double?> _probeDuration(String filePath) async {
    final player = AudioPlayer();
    try {
      await player.setSourceDeviceFile(filePath);
      final duration = await player.getDuration();
      return duration == null ? null : duration.inMilliseconds / 1000.0;
    } catch (_) {
      return null;
    } finally {
      await player.dispose();
    }
  }
}
