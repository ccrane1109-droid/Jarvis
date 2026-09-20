import 'dart:convert';

import 'package:http/http.dart' as http;

/// Fills a JSON request-body template with values, JSON-escaping strings
/// so quotes/newlines in user text can't break the payload.
///
/// Supports `{{key}}` placeholders. A placeholder that appears quoted in
/// the template (`"{{key}}"`) is replaced with a properly JSON-encoded
/// string; a bare placeholder (used for numbers, e.g. `{{duration}}`) is
/// replaced with the raw value.
String fillJsonTemplate(String template, Map<String, Object?> vars) {
  var out = template;
  for (final entry in vars.entries) {
    final quoted = '"{{${entry.key}}}"';
    if (out.contains(quoted)) {
      out = out.replaceAll(quoted, jsonEncode(entry.value));
    }
  }
  for (final entry in vars.entries) {
    final bare = '{{${entry.key}}}';
    if (!out.contains(bare)) continue;
    final value = entry.value;
    final replacement = (value is num || value is bool)
        ? value.toString()
        : jsonEncode(value);
    out = out.replaceAll(bare, replacement);
  }
  return out;
}

/// Walks a dot-path (e.g. `data.output.0.url`) through decoded JSON.
/// Numeric segments index into lists. Returns null if any step is missing.
Object? resolveJsonPath(Object? root, String path) {
  if (path.trim().isEmpty) return null;
  Object? current = root;
  for (final rawSegment in path.split('.')) {
    final segment = rawSegment.trim();
    if (segment.isEmpty) continue;
    if (current is Map) {
      current = current[segment];
    } else if (current is List) {
      final index = int.tryParse(segment);
      if (index == null || index < 0 || index >= current.length) return null;
      current = current[index];
    } else {
      return null;
    }
  }
  return current;
}

class ApiResult {
  final bool ok;
  final int? statusCode;
  final String? bodyText;
  final List<int>? bodyBytes;
  final String? contentType;
  final String? errorMessage;

  const ApiResult({
    required this.ok,
    this.statusCode,
    this.bodyText,
    this.bodyBytes,
    this.contentType,
    this.errorMessage,
  });

  Object? get decodedJson {
    if (bodyText == null) return null;
    try {
      return jsonDecode(bodyText!);
    } catch (_) {
      return null;
    }
  }
}

class ApiClient {
  final http.Client _client;

  ApiClient({http.Client? client}) : _client = client ?? http.Client();

  Future<ApiResult> post({
    required String endpointUrl,
    required String authHeaderName,
    required String apiKey,
    required String jsonBody,
    bool expectBinary = false,
  }) async {
    final uri = Uri.tryParse(endpointUrl);
    if (uri == null || !uri.hasScheme) {
      return const ApiResult(
        ok: false,
        errorMessage: 'Endpoint URL is missing or invalid.',
      );
    }
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (apiKey.trim().isNotEmpty) {
      headers[authHeaderName.trim().isEmpty
              ? 'Authorization'
              : authHeaderName.trim()] =
          'Bearer $apiKey';
    }
    try {
      final response = await _client
          .post(uri, headers: headers, body: jsonBody)
          .timeout(const Duration(seconds: 120));
      final ok = response.statusCode >= 200 && response.statusCode < 300;
      if (expectBinary) {
        return ApiResult(
          ok: ok,
          statusCode: response.statusCode,
          bodyBytes: response.bodyBytes,
          contentType: response.headers['content-type'],
          errorMessage: ok ? null : 'HTTP ${response.statusCode}',
        );
      }
      return ApiResult(
        ok: ok,
        statusCode: response.statusCode,
        bodyText: response.body,
        contentType: response.headers['content-type'],
        errorMessage: ok
            ? null
            : 'HTTP ${response.statusCode}: ${_truncate(response.body, 300)}',
      );
    } catch (e) {
      return ApiResult(ok: false, errorMessage: 'Network error: $e');
    }
  }

  Future<ApiResult> getBytes(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme) {
      return const ApiResult(ok: false, errorMessage: 'Invalid URL.');
    }
    try {
      final response = await _client
          .get(uri)
          .timeout(const Duration(seconds: 120));
      final ok = response.statusCode >= 200 && response.statusCode < 300;
      return ApiResult(
        ok: ok,
        statusCode: response.statusCode,
        bodyBytes: response.bodyBytes,
        contentType: response.headers['content-type'],
        errorMessage: ok ? null : 'HTTP ${response.statusCode}',
      );
    } catch (e) {
      return ApiResult(ok: false, errorMessage: 'Network error: $e');
    }
  }

  static String _truncate(String s, int n) =>
      s.length <= n ? s : '${s.substring(0, n)}…';
}
