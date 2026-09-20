/// A user-configured connection to an external AI API.
///
/// AI Video Creator does not ship with any bundled AI provider. Every
/// generation step (script, voiceover, images, video clips) is powered by
/// a [ConnectionConfig] the user points at an HTTP API of their choice,
/// using their own API key. This keeps the app honest about not claiming
/// integrations it hasn't verified, and keeps API costs and provider
/// choice entirely in the user's control.
enum ConnectionKind { script, voiceover, image, clipVideo }

enum ResponseKind { jsonField, binary }

class ConnectionConfig {
  final String id;
  final String name;
  final ConnectionKind kind;
  final String endpointUrl;
  final String authHeader;
  final String apiKey;
  final String bodyTemplate;
  final ResponseKind responseKind;

  /// Dot-path to the field in a JSON response holding the result
  /// (a script string, an audio/image URL or base64 blob, a video URL).
  /// Ignored when [responseKind] is [ResponseKind.binary].
  final String responsePath;

  const ConnectionConfig({
    required this.id,
    required this.name,
    required this.kind,
    required this.endpointUrl,
    this.authHeader = 'Authorization',
    this.apiKey = '',
    required this.bodyTemplate,
    this.responseKind = ResponseKind.jsonField,
    this.responsePath = '',
  });

  ConnectionConfig copyWith({
    String? name,
    String? endpointUrl,
    String? authHeader,
    String? apiKey,
    String? bodyTemplate,
    ResponseKind? responseKind,
    String? responsePath,
  }) {
    return ConnectionConfig(
      id: id,
      name: name ?? this.name,
      kind: kind,
      endpointUrl: endpointUrl ?? this.endpointUrl,
      authHeader: authHeader ?? this.authHeader,
      apiKey: apiKey ?? this.apiKey,
      bodyTemplate: bodyTemplate ?? this.bodyTemplate,
      responseKind: responseKind ?? this.responseKind,
      responsePath: responsePath ?? this.responsePath,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'kind': kind.name,
    'endpointUrl': endpointUrl,
    'authHeader': authHeader,
    'apiKey': apiKey,
    'bodyTemplate': bodyTemplate,
    'responseKind': responseKind.name,
    'responsePath': responsePath,
  };

  factory ConnectionConfig.fromJson(Map<String, dynamic> json) =>
      ConnectionConfig(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'Untitled connection',
        kind: ConnectionKind.values.firstWhere(
          (k) => k.name == json['kind'],
          orElse: () => ConnectionKind.script,
        ),
        endpointUrl: json['endpointUrl'] as String? ?? '',
        authHeader: json['authHeader'] as String? ?? 'Authorization',
        apiKey: json['apiKey'] as String? ?? '',
        bodyTemplate: json['bodyTemplate'] as String? ?? '',
        responseKind: ResponseKind.values.firstWhere(
          (r) => r.name == json['responseKind'],
          orElse: () => ResponseKind.jsonField,
        ),
        responsePath: json['responsePath'] as String? ?? '',
      );
}

/// Illustrative starting templates shown when adding a connection. These are
/// examples to adapt, not verified/guaranteed-current integrations — always
/// check the provider's own current API docs before relying on one.
class ConnectionTemplates {
  static String bodyTemplateFor(ConnectionKind kind) {
    switch (kind) {
      case ConnectionKind.script:
        return '{\n  "prompt": "{{topic}}",\n  "scene_count": {{sceneCount}}\n}';
      case ConnectionKind.voiceover:
        return '{\n  "text": "{{text}}",\n  "voice": "default"\n}';
      case ConnectionKind.image:
        return '{\n  "prompt": "{{prompt}}",\n  "aspect_ratio": "{{aspectRatio}}"\n}';
      case ConnectionKind.clipVideo:
        return '{\n  "prompt": "{{prompt}}",\n  "aspect_ratio": "{{aspectRatio}}",\n  "duration": {{duration}}\n}';
    }
  }

  static String label(ConnectionKind kind) {
    switch (kind) {
      case ConnectionKind.script:
        return 'Script generation (LLM)';
      case ConnectionKind.voiceover:
        return 'Voiceover (text-to-speech)';
      case ConnectionKind.image:
        return 'Image generation';
      case ConnectionKind.clipVideo:
        return 'Video clip generation';
    }
  }
}
