import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../models/connection_config.dart';
import '../../state/connections_provider.dart';

class ConnectionEditorScreen extends ConsumerStatefulWidget {
  final ConnectionConfig connection;
  final bool isNew;

  const ConnectionEditorScreen({
    super.key,
    required this.connection,
    required this.isNew,
  });

  @override
  ConsumerState<ConnectionEditorScreen> createState() =>
      _ConnectionEditorScreenState();
}

class _ConnectionEditorScreenState
    extends ConsumerState<ConnectionEditorScreen> {
  late final TextEditingController _name;
  late final TextEditingController _endpoint;
  late final TextEditingController _authHeader;
  late final TextEditingController _apiKey;
  late final TextEditingController _bodyTemplate;
  late final TextEditingController _responsePath;
  late ResponseKind _responseKind;
  bool _obscureKey = true;

  @override
  void initState() {
    super.initState();
    final c = widget.connection;
    _name = TextEditingController(text: c.name);
    _endpoint = TextEditingController(text: c.endpointUrl);
    _authHeader = TextEditingController(text: c.authHeader);
    _apiKey = TextEditingController(text: c.apiKey);
    _bodyTemplate = TextEditingController(text: c.bodyTemplate);
    _responsePath = TextEditingController(text: c.responsePath);
    _responseKind = c.responseKind;
  }

  @override
  void dispose() {
    _name.dispose();
    _endpoint.dispose();
    _authHeader.dispose();
    _apiKey.dispose();
    _bodyTemplate.dispose();
    _responsePath.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final updated = widget.connection.copyWith(
      name: _name.text.trim().isEmpty
          ? ConnectionTemplates.label(widget.connection.kind)
          : _name.text.trim(),
      endpointUrl: _endpoint.text.trim(),
      authHeader: _authHeader.text.trim().isEmpty
          ? 'Authorization'
          : _authHeader.text.trim(),
      apiKey: _apiKey.text,
      bodyTemplate: _bodyTemplate.text,
      responseKind: _responseKind,
      responsePath: _responsePath.text.trim(),
    );
    await ref.read(connectionsProvider.notifier).upsert(updated);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final kind = widget.connection.kind;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isNew ? 'New connection' : 'Edit connection'),
        actions: [
          if (!widget.isNew)
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: () async {
                await ref
                    .read(connectionsProvider.notifier)
                    .remove(widget.connection.id);
                if (context.mounted) Navigator.pop(context);
              },
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            ConnectionTemplates.label(kind),
            style: const TextStyle(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Connection name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _endpoint,
            decoration: const InputDecoration(
              labelText: 'Endpoint URL',
              hintText: 'https://your-provider.example.com/v1/...',
            ),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _authHeader,
            decoration: const InputDecoration(labelText: 'Auth header name'),
          ),
          const SizedBox(height: 4),
          const Text(
            'Sent as "<header>: Bearer <key>". Change it if your provider expects a different header, e.g. "x-api-key".',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _apiKey,
            obscureText: _obscureKey,
            decoration: InputDecoration(
              labelText: 'API key',
              suffixIcon: IconButton(
                icon: Icon(
                  _obscureKey
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
                onPressed: () => setState(() => _obscureKey = !_obscureKey),
              ),
            ),
          ),
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 12),
          TextField(
            controller: _bodyTemplate,
            decoration: const InputDecoration(
              labelText: 'Request body template (JSON)',
              alignLabelWithHint: true,
            ),
            maxLines: 6,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
          ),
          const SizedBox(height: 8),
          Text(
            _placeholderHintFor(kind),
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Response type',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          SegmentedButton<ResponseKind>(
            segments: const [
              ButtonSegment(
                value: ResponseKind.jsonField,
                label: Text('JSON field'),
              ),
              ButtonSegment(
                value: ResponseKind.binary,
                label: Text('Raw file bytes'),
              ),
            ],
            selected: {_responseKind},
            onSelectionChanged: (s) => setState(() => _responseKind = s.first),
          ),
          const SizedBox(height: 12),
          if (_responseKind == ResponseKind.jsonField) ...[
            TextField(
              controller: _responsePath,
              decoration: InputDecoration(
                labelText: 'Result field (dot-path)',
                hintText: _resultFieldHintFor(kind),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              _resultFieldExplanationFor(kind),
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          ] else
            Text(
              'The endpoint\'s response body will be saved directly as the ${_binaryNounFor(kind)} file.',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          const SizedBox(height: 28),
          ElevatedButton(
            onPressed: _save,
            child: const Text('Save connection'),
          ),
        ],
      ),
    );
  }

  String _placeholderHintFor(ConnectionKind kind) {
    switch (kind) {
      case ConnectionKind.script:
        return 'Placeholders: {{topic}}, {{sceneCount}}. Example — verify against your provider\'s current docs.';
      case ConnectionKind.voiceover:
        return 'Placeholder: {{text}}. Example — verify against your provider\'s current docs.';
      case ConnectionKind.image:
        return 'Placeholders: {{prompt}}, {{aspectRatio}}. Example — verify against your provider\'s current docs.';
      case ConnectionKind.clipVideo:
        return 'Placeholders: {{prompt}}, {{aspectRatio}}, {{duration}}. Example — verify against your provider\'s current docs.';
    }
  }

  String _resultFieldHintFor(ConnectionKind kind) {
    switch (kind) {
      case ConnectionKind.script:
        return 'e.g. choices.0.message.content';
      case ConnectionKind.voiceover:
      case ConnectionKind.image:
        return 'e.g. data.0.url';
      case ConnectionKind.clipVideo:
        return 'e.g. video_url';
    }
  }

  String _resultFieldExplanationFor(ConnectionKind kind) {
    switch (kind) {
      case ConnectionKind.script:
        return 'Dot-path to the generated script text inside the JSON response.';
      case ConnectionKind.voiceover:
        return 'Dot-path to an audio URL or base64 string in the response.';
      case ConnectionKind.image:
        return 'Dot-path to an image URL or base64 string in the response.';
      case ConnectionKind.clipVideo:
        return 'Dot-path to the generated video\'s URL in the response.';
    }
  }

  String _binaryNounFor(ConnectionKind kind) {
    switch (kind) {
      case ConnectionKind.voiceover:
        return 'audio';
      case ConnectionKind.image:
        return 'image';
      default:
        return 'response';
    }
  }
}
