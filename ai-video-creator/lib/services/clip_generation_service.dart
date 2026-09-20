import '../core/network/api_client.dart';
import '../models/connection_config.dart';

class ClipGenerationOutcome {
  final bool ok;
  final String? videoUrl;
  final String? rawResponse;
  final String? errorMessage;

  const ClipGenerationOutcome({
    required this.ok,
    this.videoUrl,
    this.rawResponse,
    this.errorMessage,
  });
}

/// Calls a single-request text-to-video endpoint. This assumes the
/// endpoint returns the finished video (or a URL to it) directly in its
/// response. Providers that use an async submit-then-poll job model need
/// a small server-side shim in front of them that waits and returns the
/// final result, since this app doesn't guess at any particular polling
/// contract.
class ClipGenerationService {
  final ApiClient _client;

  ClipGenerationService({ApiClient? client}) : _client = client ?? ApiClient();

  Future<ClipGenerationOutcome> generate({
    required ConnectionConfig connection,
    required String prompt,
    required String aspectRatio,
    required int durationSeconds,
  }) async {
    final body = fillJsonTemplate(connection.bodyTemplate, {
      'prompt': prompt,
      'aspectRatio': aspectRatio,
      'duration': durationSeconds,
    });
    final result = await _client.post(
      endpointUrl: connection.endpointUrl,
      authHeaderName: connection.authHeader,
      apiKey: connection.apiKey,
      jsonBody: body,
    );
    if (!result.ok) {
      return ClipGenerationOutcome(
        ok: false,
        rawResponse: result.bodyText,
        errorMessage: result.errorMessage ?? 'Request failed.',
      );
    }
    final value = resolveJsonPath(result.decodedJson, connection.responsePath);
    return ClipGenerationOutcome(
      ok: true,
      videoUrl: value is String ? value : null,
      rawResponse: result.bodyText,
    );
  }
}
