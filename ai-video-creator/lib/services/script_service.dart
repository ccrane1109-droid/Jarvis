import '../core/network/api_client.dart';
import '../core/utils/script_split.dart';
import '../models/connection_config.dart';

class ScriptGenerationResult {
  final bool ok;
  final List<String> sceneTexts;
  final String? errorMessage;

  const ScriptGenerationResult({
    required this.ok,
    this.sceneTexts = const [],
    this.errorMessage,
  });
}

class ScriptService {
  final ApiClient _client;

  ScriptService({ApiClient? client}) : _client = client ?? ApiClient();

  Future<ScriptGenerationResult> generate({
    required ConnectionConfig connection,
    required String topic,
    required int sceneCount,
  }) async {
    final body = fillJsonTemplate(connection.bodyTemplate, {
      'topic': topic,
      'sceneCount': sceneCount,
    });
    final result = await _client.post(
      endpointUrl: connection.endpointUrl,
      authHeaderName: connection.authHeader,
      apiKey: connection.apiKey,
      jsonBody: body,
    );
    if (!result.ok) {
      return ScriptGenerationResult(
        ok: false,
        errorMessage: result.errorMessage ?? 'Request failed.',
      );
    }
    final value = resolveJsonPath(result.decodedJson, connection.responsePath);
    if (value is! String || value.trim().isEmpty) {
      return ScriptGenerationResult(
        ok: false,
        errorMessage:
            'No script text found at response path "${connection.responsePath}". Check the Connection settings.',
      );
    }
    final scenes = splitScriptIntoScenes(value, sceneCount);
    return ScriptGenerationResult(ok: true, sceneTexts: scenes);
  }
}
