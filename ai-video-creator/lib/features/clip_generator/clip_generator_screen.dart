import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/ids.dart';
import '../../models/connection_config.dart';
import '../../models/generated_clip.dart';
import '../../services/clip_generation_service.dart';
import '../../state/clips_provider.dart';
import '../../state/connections_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/status_badge.dart';
import 'clip_video_preview.dart';

class ClipGeneratorScreen extends ConsumerStatefulWidget {
  const ClipGeneratorScreen({super.key});

  @override
  ConsumerState<ClipGeneratorScreen> createState() =>
      _ClipGeneratorScreenState();
}

class _ClipGeneratorScreenState extends ConsumerState<ClipGeneratorScreen> {
  final _promptController = TextEditingController();
  String _aspectRatio = '16:9';
  int _duration = 5;
  ConnectionConfig? _selectedConnection;
  bool _isGenerating = false;

  final _service = ClipGenerationService();

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _generate() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) {
      _toast('Enter a prompt first.');
      return;
    }
    final connection = _selectedConnection;
    if (connection == null) {
      _toast('Add and select a video clip connection in Settings first.');
      return;
    }

    setState(() => _isGenerating = true);
    final clip = GeneratedClip(
      id: newId('clip'),
      prompt: prompt,
      aspectRatio: _aspectRatio,
      durationSeconds: _duration,
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );
    await ref.read(clipsProvider.notifier).add(clip);

    final outcome = await _service.generate(
      connection: connection,
      prompt: prompt,
      aspectRatio: _aspectRatio,
      durationSeconds: _duration,
    );

    final updated = clip.copyWith(
      status: outcome.ok ? ClipStatus.success : ClipStatus.error,
      videoUrl: outcome.videoUrl,
      errorMessage: outcome.ok
          ? (outcome.videoUrl == null
                ? 'Request succeeded but no video URL was found in the response.'
                : null)
          : outcome.errorMessage,
    );
    await ref.read(clipsProvider.notifier).updateClip(updated);

    if (mounted) {
      setState(() => _isGenerating = false);
      _toast(outcome.ok ? 'Generation finished.' : 'Generation failed.');
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final clipConnections = ref.watch(
      connectionsByKindProvider(ConnectionKind.clipVideo),
    );
    _selectedConnection ??= clipConnections.isNotEmpty
        ? clipConnections.first
        : null;
    if (_selectedConnection != null &&
        !clipConnections.contains(_selectedConnection)) {
      _selectedConnection = clipConnections.isNotEmpty
          ? clipConnections.first
          : null;
    }
    final clipsAsync = ref.watch(clipsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Clip Generator')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Generate a short AI video clip',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Good for B-roll and inserts — calls the text-to-video connection you configure in Settings.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _promptController,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Prompt',
                      hintText: 'A drone shot flying over a misty mountain forest at sunrise',
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: _aspectRatio,
                          decoration: const InputDecoration(
                            labelText: 'Aspect ratio',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: '16:9',
                              child: Text('16:9 landscape'),
                            ),
                            DropdownMenuItem(
                              value: '9:16',
                              child: Text('9:16 portrait'),
                            ),
                            DropdownMenuItem(
                              value: '1:1',
                              child: Text('1:1 square'),
                            ),
                          ],
                          onChanged: (v) =>
                              setState(() => _aspectRatio = v ?? '16:9'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          initialValue: _duration.toString(),
                          decoration: const InputDecoration(
                            labelText: 'Duration (s)',
                          ),
                          keyboardType: TextInputType.number,
                          onChanged: (v) =>
                              _duration = int.tryParse(v) ?? _duration,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<ConnectionConfig>(
                    initialValue: _selectedConnection,
                    decoration: const InputDecoration(labelText: 'Connection'),
                    items: clipConnections
                        .map(
                          (c) => DropdownMenuItem(
                            value: c,
                            child: Text(
                              c.name,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => _selectedConnection = v),
                    hint: const Text('No connection configured'),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _isGenerating ? null : _generate,
                      child: _isGenerating
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Generate Clip'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'History',
            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
          ),
          const SizedBox(height: 12),
          clipsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Text('Could not load history: $e'),
            data: (clips) {
              if (clips.isEmpty) {
                return const EmptyState(
                  icon: Icons.movie_filter_outlined,
                  title: 'No clips yet',
                  message: 'Generated clips will show up here.',
                );
              }
              return Column(
                children: clips.map((c) => _ClipCard(clip: c)).toList(),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ClipCard extends ConsumerWidget {
  final GeneratedClip clip;
  const _ClipCard({required this.clip});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    clip.prompt,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.delete_outline,
                    size: 18,
                    color: AppColors.textSecondary,
                  ),
                  onPressed: () =>
                      ref.read(clipsProvider.notifier).remove(clip.id),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _badgeFor(clip.status),
                const SizedBox(width: 8),
                Text(
                  '${clip.aspectRatio} · ${clip.durationSeconds}s',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            if (clip.status == ClipStatus.success && clip.videoUrl != null) ...[
              const SizedBox(height: 12),
              ClipVideoPreview(url: clip.videoUrl!),
            ] else if (clip.status == ClipStatus.error) ...[
              const SizedBox(height: 8),
              Text(
                clip.errorMessage ?? 'Generation failed.',
                style: const TextStyle(color: AppColors.danger, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _badgeFor(ClipStatus status) {
    switch (status) {
      case ClipStatus.success:
        return StatusBadge.success('Completed');
      case ClipStatus.error:
        return StatusBadge.danger('Failed');
      case ClipStatus.pending:
        return StatusBadge.warning('Pending');
    }
  }
}
