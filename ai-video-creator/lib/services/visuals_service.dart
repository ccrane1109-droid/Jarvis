import 'dart:convert';
import 'dart:io';

import 'package:image_picker/image_picker.dart';

import '../core/network/api_client.dart';
import '../core/utils/ids.dart';
import '../models/connection_config.dart';

class VisualResult {
  final bool ok;
  final String? filePath;
  final String? errorMessage;

  const VisualResult({required this.ok, this.filePath, this.errorMessage});
}

class VisualsService {
  final ApiClient _client;
  final ImagePicker _imagePicker;

  VisualsService({ApiClient? client, ImagePicker? imagePicker})
    : _client = client ?? ApiClient(),
      _imagePicker = imagePicker ?? ImagePicker();

  Future<String?> pickLocalImage() async {
    final picked = await _imagePicker.pickImage(source: ImageSource.gallery);
    return picked?.path;
  }

  Future<String?> pickLocalVideo() async {
    final picked = await _imagePicker.pickVideo(source: ImageSource.gallery);
    return picked?.path;
  }

  Future<VisualResult> generateImage({
    required ConnectionConfig connection,
    required String prompt,
    required String aspectRatio,
    required Directory outputDir,
  }) async {
    final body = fillJsonTemplate(connection.bodyTemplate, {
      'prompt': prompt,
      'aspectRatio': aspectRatio,
    });
    final expectBinary = connection.responseKind == ResponseKind.binary;
    final result = await _client.post(
      endpointUrl: connection.endpointUrl,
      authHeaderName: connection.authHeader,
      apiKey: connection.apiKey,
      jsonBody: body,
      expectBinary: expectBinary,
    );
    if (!result.ok) {
      return VisualResult(
        ok: false,
        errorMessage: result.errorMessage ?? 'Request failed.',
      );
    }

    List<int>? bytes;
    if (expectBinary) {
      bytes = result.bodyBytes;
    } else {
      final value = resolveJsonPath(
        result.decodedJson,
        connection.responsePath,
      );
      if (value is String && value.startsWith('http')) {
        final download = await _client.getBytes(value);
        bytes = download.bodyBytes;
        if (!download.ok || bytes == null) {
          return VisualResult(
            ok: false,
            errorMessage: download.errorMessage ?? 'Could not download image.',
          );
        }
      } else if (value is String && value.isNotEmpty) {
        bytes = _tryDecodeBase64(value);
      }
    }

    if (bytes == null || bytes.isEmpty) {
      return const VisualResult(
        ok: false,
        errorMessage: 'No image data found in the response. Check the Connection settings.',
      );
    }

    final extension = _guessExtension(result.contentType);
    final file = File('${outputDir.path}/${newId('image')}.$extension');
    await file.writeAsBytes(bytes);
    return VisualResult(ok: true, filePath: file.path);
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
    if (contentType == null) return 'png';
    if (contentType.contains('jpeg') || contentType.contains('jpg')) {
      return 'jpg';
    }
    if (contentType.contains('webp')) return 'webp';
    return 'png';
  }
}
