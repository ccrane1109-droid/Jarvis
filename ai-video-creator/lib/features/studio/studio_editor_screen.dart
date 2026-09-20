import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/caption_builder.dart';
import '../../core/utils/ids.dart';
import '../../models/caption_line.dart';
import '../../models/connection_config.dart';
import '../../models/scene.dart';
import '../../models/video_project.dart';
import '../../services/script_service.dart';
import '../../services/video_render_service.dart';
import '../../services/visuals_service.dart';
import '../../services/voiceover_service.dart';
import '../../services/music_service.dart';
import '../../state/connections_provider.dart';
import '../../state/projects_provider.dart';
import 'widgets/voiceover_preview_button.dart';

class StudioEditorScreen extends ConsumerStatefulWidget {
  final String projectId;
  const StudioEditorScreen({super.key, required this.projectId});

  @override
  ConsumerState<StudioEditorScreen> createState() => _StudioEditorScreenState();
}

class _StudioEditorScreenState extends ConsumerState<StudioEditorScreen> {
  VideoProject? _project;
  int _step = 0;

  final _topicController = TextEditingController();
  int _sceneCountTarget = 5;
  final Map<String, TextEditingController> _sceneControllers = {};
  final Map<String, TextEditingController> _captionControllers = {};

  ConnectionConfig? _scriptConnection;
  ConnectionConfig? _voiceoverConnection;
  ConnectionConfig? _imageConnection;

  bool _busy = false;
  String? _renderStatus;
  VideoPlayerController? _previewController;

  final _scriptService = ScriptService();
  final _voiceoverService = VoiceoverService();
  final _visualsService = VisualsService();
  final _musicService = MusicService();
  final _renderService = VideoRenderService();

  @override
  void dispose() {
    _topicController.dispose();
    for (final c in _sceneControllers.values) {
      c.dispose();
    }
    for (final c in _captionControllers.values) {
      c.dispose();
    }
    _previewController?.dispose();
    super.dispose();
  }

  void _ensureLoaded(List<VideoProject> projects) {
    if (_project != null) return;
    final found = projects
        .where((p) => p.id == widget.projectId)
        .cast<VideoProject?>()
        .firstOrNull;
    if (found != null) {
      _project = found;
      _topicController.text = found.topic;
    }
  }

  void _persist(VideoProject updated) {
    setState(() => _project = updated);
    ref.read(projectsProvider.notifier).saveProject(updated);
  }

  void _updateScene(String sceneId, Scene Function(Scene) update) {
    final project = _project!;
    final scenes = project.scenes
        .map((s) => s.id == sceneId ? update(s) : s)
        .toList();
    _persist(project.copyWith(scenes: scenes));
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  TextEditingController _sceneController(Scene scene) {
    return _sceneControllers.putIfAbsent(
      scene.id,
      () => TextEditingController(text: scene.text),
    );
  }

  TextEditingController _captionController(CaptionLine line) {
    return _captionControllers.putIfAbsent(
      line.id,
      () => TextEditingController(text: line.text),
    );
  }

  @override
  Widget build(BuildContext context) {
    final projectsAsync = ref.watch(projectsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(_project?.title ?? 'Project')),
      body: projectsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load project: $e')),
        data: (projects) {
          _ensureLoaded(projects);
          final project = _project;
          if (project == null) {
            return const Center(child: Text('Project not found.'));
          }
          return Stepper(
            currentStep: _step,
            onStepTapped: (i) => setState(() => _step = i),
            controlsBuilder: (context, details) => Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Row(
                children: [
                  if (details.stepIndex > 0)
                    OutlinedButton(
                      onPressed: details.onStepCancel,
                      child: const Text('Back'),
                    ),
                  const SizedBox(width: 12),
                  if (details.stepIndex < 5)
                    ElevatedButton(
                      onPressed: details.onStepContinue,
                      child: const Text('Next'),
                    ),
                ],
              ),
            ),
            onStepContinue: () =>
                setState(() => _step = (_step + 1).clamp(0, 5)),
            onStepCancel: () => setState(() => _step = (_step - 1).clamp(0, 5)),
            steps: [
              Step(
                title: const Text('Script'),
                isActive: _step == 0,
                state: project.scenes.isNotEmpty
                    ? StepState.complete
                    : StepState.indexed,
                content: _buildScriptStep(project),
              ),
              Step(
                title: const Text('Voiceover'),
                isActive: _step == 1,
                state: project.scenes.any((s) => s.voiceoverFilePath != null)
                    ? StepState.complete
                    : StepState.indexed,
                content: _buildVoiceoverStep(project),
              ),
              Step(
                title: const Text('Visuals'),
                isActive: _step == 2,
                state:
                    project.scenes.every((s) => s.visualPath != null) &&
                        project.scenes.isNotEmpty
                    ? StepState.complete
                    : StepState.indexed,
                content: _buildVisualsStep(project),
              ),
              Step(
                title: const Text('Captions'),
                isActive: _step == 3,
                state: project.scenes.any((s) => s.captions.isNotEmpty)
                    ? StepState.complete
                    : StepState.indexed,
                content: _buildCaptionsStep(project),
              ),
              Step(
                title: const Text('Music'),
                isActive: _step == 4,
                state: project.musicFilePath != null
                    ? StepState.complete
                    : StepState.indexed,
                content: _buildMusicStep(project),
              ),
              Step(
                title: const Text('Export'),
                isActive: _step == 5,
                state: project.status == ProjectStatus.exported
                    ? StepState.complete
                    : StepState.indexed,
                content: _buildExportStep(project),
              ),
            ],
          );
        },
      ),
    );
  }

  // ---------------- Step 1: Script ----------------

  Widget _buildScriptStep(VideoProject project) {
    final scriptConnections = ref.watch(
      connectionsByKindProvider(ConnectionKind.script),
    );
    _scriptConnection ??= scriptConnections.isNotEmpty
        ? scriptConnections.first
        : null;

    if (project.scenes.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _topicController,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Video topic',
              hintText: 'e.g. 5 productivity habits for remote workers',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Text('Target scenes:'),
              Expanded(
                child: Slider(
                  value: _sceneCountTarget.toDouble(),
                  min: 2,
                  max: 12,
                  divisions: 10,
                  label: '$_sceneCountTarget',
                  onChanged: (v) =>
                      setState(() => _sceneCountTarget = v.round()),
                ),
              ),
              Text('$_sceneCountTarget'),
            ],
          ),
          DropdownButtonFormField<ConnectionConfig>(
            initialValue: _scriptConnection,
            decoration: const InputDecoration(labelText: 'Script connection'),
            items: scriptConnections
                .map(
                  (c) => DropdownMenuItem(
                    value: c,
                    child: Text(c.name, overflow: TextOverflow.ellipsis),
                  ),
                )
                .toList(),
            onChanged: (v) => setState(() => _scriptConnection = v),
            hint: const Text('No script connection configured'),
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _busy ? null : () => _generateScript(project),
            child: _busy
                ? const _InlineSpinner()
                : const Text('Generate Script'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: () => _persist(
              project.copyWith(
                scenes: [Scene(id: newId('scene'), text: '')],
              ),
            ),
            child: const Text('Write scenes manually instead'),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < project.scenes.length; i++)
          _sceneTextCard(project, i),
        const SizedBox(height: 8),
        Row(
          children: [
            TextButton.icon(
              onPressed: () {
                final scenes = List<Scene>.from(project.scenes)
                  ..add(Scene(id: newId('scene'), text: ''));
                _persist(project.copyWith(scenes: scenes));
              },
              icon: const Icon(Icons.add),
              label: const Text('Add scene'),
            ),
            const Spacer(),
            TextButton(
              onPressed: () => _persist(project.copyWith(scenes: [])),
              child: const Text('Start over'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _sceneTextCard(VideoProject project, int index) {
    final scene = project.scenes[index];
    final controller = _sceneController(scene);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Scene ${index + 1}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.arrow_upward, size: 18),
                  onPressed: index == 0
                      ? null
                      : () => _moveScene(project, index, index - 1),
                ),
                IconButton(
                  icon: const Icon(Icons.arrow_downward, size: 18),
                  onPressed: index == project.scenes.length - 1
                      ? null
                      : () => _moveScene(project, index, index + 1),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.delete_outline,
                    size: 18,
                    color: AppColors.textSecondary,
                  ),
                  onPressed: () {
                    final scenes = List<Scene>.from(project.scenes)
                      ..removeAt(index);
                    _sceneControllers.remove(scene.id)?.dispose();
                    _persist(project.copyWith(scenes: scenes));
                  },
                ),
              ],
            ),
            TextField(
              controller: controller,
              maxLines: null,
              decoration: const InputDecoration(
                hintText: 'Narration for this scene',
              ),
              onChanged: (v) =>
                  _updateScene(scene.id, (s) => s.copyWith(text: v)),
            ),
          ],
        ),
      ),
    );
  }

  void _moveScene(VideoProject project, int from, int to) {
    final scenes = List<Scene>.from(project.scenes);
    final item = scenes.removeAt(from);
    scenes.insert(to, item);
    _persist(project.copyWith(scenes: scenes));
  }

  Future<void> _generateScript(VideoProject project) async {
    final connection = _scriptConnection;
    if (connection == null) {
      _toast('Add and select a script connection first.');
      return;
    }
    if (_topicController.text.trim().isEmpty) {
      _toast('Enter a topic first.');
      return;
    }
    setState(() => _busy = true);
    final result = await _scriptService.generate(
      connection: connection,
      topic: _topicController.text.trim(),
      sceneCount: _sceneCountTarget,
    );
    setState(() => _busy = false);
    if (!result.ok) {
      _toast(result.errorMessage ?? 'Script generation failed.');
      return;
    }
    final scenes = result.sceneTexts
        .map((t) => Scene(id: newId('scene'), text: t))
        .toList();
    _persist(
      project.copyWith(topic: _topicController.text.trim(), scenes: scenes),
    );
  }

  // ---------------- Step 2: Voiceover ----------------

  Widget _buildVoiceoverStep(VideoProject project) {
    final voiceConnections = ref.watch(
      connectionsByKindProvider(ConnectionKind.voiceover),
    );
    _voiceoverConnection ??= voiceConnections.isNotEmpty
        ? voiceConnections.first
        : null;

    if (project.scenes.isEmpty) {
      return const Text(
        'Write a script first.',
        style: TextStyle(color: AppColors.textSecondary),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<ConnectionConfig>(
          initialValue: _voiceoverConnection,
          decoration: const InputDecoration(labelText: 'Voiceover connection'),
          items: voiceConnections
              .map(
                (c) => DropdownMenuItem(
                  value: c,
                  child: Text(c.name, overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _voiceoverConnection = v),
          hint: const Text('No voiceover connection configured'),
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < project.scenes.length; i++)
          _voiceoverCard(project, i),
      ],
    );
  }

  Widget _voiceoverCard(VideoProject project, int index) {
    final scene = project.scenes[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Scene ${index + 1}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    scene.text,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                  if (scene.voiceoverDurationSeconds != null)
                    Text(
                      '${scene.voiceoverDurationSeconds!.toStringAsFixed(1)}s',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
            if (scene.voiceoverFilePath != null)
              VoiceoverPreviewButton(filePath: scene.voiceoverFilePath!),
            IconButton(
              icon: const Icon(Icons.mic),
              tooltip: 'Generate voiceover',
              onPressed: () => _generateVoiceover(project, scene),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _generateVoiceover(VideoProject project, Scene scene) async {
    final connection = _voiceoverConnection;
    if (connection == null) {
      _toast('Add and select a voiceover connection first.');
      return;
    }
    if (scene.text.trim().isEmpty) {
      _toast('This scene has no narration text yet.');
      return;
    }
    final mediaDir = await ref
        .read(projectStoreProvider)
        .mediaDirFor(project.id);
    final result = await _voiceoverService.synthesize(
      connection: connection,
      text: scene.text,
      outputDir: mediaDir,
    );
    if (!result.ok) {
      _toast(result.errorMessage ?? 'Voiceover generation failed.');
      return;
    }
    _updateScene(
      scene.id,
      (s) => s.copyWith(
        voiceoverFilePath: result.filePath,
        voiceoverDurationSeconds: result.durationSeconds,
      ),
    );
  }

  // ---------------- Step 3: Visuals ----------------

  Widget _buildVisualsStep(VideoProject project) {
    final imageConnections = ref.watch(
      connectionsByKindProvider(ConnectionKind.image),
    );
    _imageConnection ??= imageConnections.isNotEmpty
        ? imageConnections.first
        : null;

    if (project.scenes.isEmpty) {
      return const Text(
        'Write a script first.',
        style: TextStyle(color: AppColors.textSecondary),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<ConnectionConfig>(
          initialValue: _imageConnection,
          decoration: const InputDecoration(
            labelText: 'Image generation connection (optional)',
          ),
          items: imageConnections
              .map(
                (c) => DropdownMenuItem(
                  value: c,
                  child: Text(c.name, overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _imageConnection = v),
          hint: const Text('None — pick local media only'),
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < project.scenes.length; i++) _visualCard(project, i),
      ],
    );
  }

  Widget _visualCard(VideoProject project, int index) {
    final scene = project.scenes[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Scene ${index + 1}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            _visualPreview(scene),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  icon: const Icon(Icons.image_outlined, size: 18),
                  label: const Text('Pick image'),
                  onPressed: () async {
                    final path = await _visualsService.pickLocalImage();
                    if (path != null) {
                      _updateScene(
                        scene.id,
                        (s) => s.copyWith(
                          visualType: VisualSourceType.localImage,
                          visualPath: path,
                        ),
                      );
                    }
                  },
                ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.videocam_outlined, size: 18),
                  label: const Text('Pick video'),
                  onPressed: () async {
                    final path = await _visualsService.pickLocalVideo();
                    if (path != null) {
                      _updateScene(
                        scene.id,
                        (s) => s.copyWith(
                          visualType: VisualSourceType.localVideo,
                          visualPath: path,
                        ),
                      );
                    }
                  },
                ),
                if (_imageConnection != null)
                  OutlinedButton.icon(
                    icon: const Icon(Icons.auto_awesome, size: 18),
                    label: const Text('Generate image'),
                    onPressed: () => _generateImage(project, scene),
                  ),
                if (scene.visualPath != null)
                  TextButton.icon(
                    icon: const Icon(Icons.close, size: 18),
                    label: const Text('Clear'),
                    onPressed: () => _updateScene(
                      scene.id,
                      (s) => s.copyWith(clearVisual: true),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _visualPreview(Scene scene) {
    if (scene.visualPath == null) {
      return Container(
        height: 90,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.surfaceAlt,
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Text(
          'No visual set',
          style: TextStyle(color: AppColors.textSecondary),
        ),
      );
    }
    if (scene.visualType == VisualSourceType.localVideo) {
      return Container(
        height: 90,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.surfaceAlt,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.videocam, color: AppColors.accentAlt),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                p.basename(scene.visualPath!),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.file(
        File(scene.visualPath!),
        height: 120,
        width: double.infinity,
        fit: BoxFit.cover,
      ),
    );
  }

  Future<void> _generateImage(VideoProject project, Scene scene) async {
    final connection = _imageConnection;
    if (connection == null) return;
    final mediaDir = await ref
        .read(projectStoreProvider)
        .mediaDirFor(project.id);
    final result = await _visualsService.generateImage(
      connection: connection,
      prompt: scene.text,
      aspectRatio: project.aspectRatio,
      outputDir: mediaDir,
    );
    if (!result.ok) {
      _toast(result.errorMessage ?? 'Image generation failed.');
      return;
    }
    _updateScene(
      scene.id,
      (s) => s.copyWith(
        visualType: VisualSourceType.generated,
        visualPath: result.filePath,
      ),
    );
  }

  // ---------------- Step 4: Captions ----------------

  Widget _buildCaptionsStep(VideoProject project) {
    if (project.scenes.isEmpty) {
      return const Text(
        'Write a script first.',
        style: TextStyle(color: AppColors.textSecondary),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < project.scenes.length; i++)
          _captionsCard(project, i),
      ],
    );
  }

  Widget _captionsCard(VideoProject project, int index) {
    final scene = project.scenes[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Scene ${index + 1}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                TextButton.icon(
                  icon: const Icon(Icons.subtitles_outlined, size: 18),
                  label: const Text('Auto-generate'),
                  onPressed: () => _autoGenerateCaptions(scene),
                ),
              ],
            ),
            if (scene.captions.isEmpty)
              const Text(
                'No captions yet.',
                style: TextStyle(color: AppColors.textSecondary),
              )
            else
              for (final line in scene.captions) _captionLineRow(scene, line),
          ],
        ),
      ),
    );
  }

  Widget _captionLineRow(Scene scene, CaptionLine line) {
    final controller = _captionController(line);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            _formatTimestamp(line.start),
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: controller,
              style: const TextStyle(fontSize: 13),
              decoration: const InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  vertical: 8,
                  horizontal: 10,
                ),
              ),
              onChanged: (v) {
                final updatedCaptions = scene.captions
                    .map((c) => c.id == line.id ? c.copyWith(text: v) : c)
                    .toList();
                _updateScene(
                  scene.id,
                  (s) => s.copyWith(captions: updatedCaptions),
                );
              },
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 16),
            onPressed: () {
              final updatedCaptions = scene.captions
                  .where((c) => c.id != line.id)
                  .toList();
              _captionControllers.remove(line.id)?.dispose();
              _updateScene(
                scene.id,
                (s) => s.copyWith(captions: updatedCaptions),
              );
            },
          ),
        ],
      ),
    );
  }

  void _autoGenerateCaptions(Scene scene) {
    final durationMs = (scene.effectiveDurationSeconds * 1000).round();
    final captions = buildCaptionsForScene(
      text: scene.text,
      totalDuration: Duration(milliseconds: durationMs),
    );
    for (final c in scene.captions) {
      _captionControllers.remove(c.id)?.dispose();
    }
    _updateScene(scene.id, (s) => s.copyWith(captions: captions));
  }

  String _formatTimestamp(Duration d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.inMinutes)}:${two(d.inSeconds.remainder(60))}';
  }

  // ---------------- Step 5: Music ----------------

  Widget _buildMusicStep(VideoProject project) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (project.musicFilePath == null)
          OutlinedButton.icon(
            icon: const Icon(Icons.music_note_outlined),
            label: const Text('Pick background music'),
            onPressed: () async {
              final path = await _musicService.pickLocalMusic();
              if (path != null) _persist(project.copyWith(musicFilePath: path));
            },
          )
        else ...[
          Row(
            children: [
              const Icon(Icons.music_note, color: AppColors.accentAlt),
              const SizedBox(width: 8),
              Expanded(child: Text(p.basename(project.musicFilePath!))),
              TextButton(
                onPressed: () => _persist(project.copyWith(clearMusic: true)),
                child: const Text('Remove'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text('Music volume: ${(project.musicVolume * 100).round()}%'),
          Slider(
            value: project.musicVolume,
            onChanged: (v) => _persist(project.copyWith(musicVolume: v)),
          ),
        ],
      ],
    );
  }

  // ---------------- Step 6: Export ----------------

  Widget _buildExportStep(VideoProject project) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          initialValue: project.aspectRatio,
          decoration: const InputDecoration(labelText: 'Aspect ratio'),
          items: const [
            DropdownMenuItem(
              value: '9:16',
              child: Text('9:16 — Shorts / Reels / TikTok'),
            ),
            DropdownMenuItem(
              value: '16:9',
              child: Text('16:9 — standard YouTube'),
            ),
            DropdownMenuItem(value: '1:1', child: Text('1:1 — square')),
          ],
          onChanged: (v) =>
              _persist(project.copyWith(aspectRatio: v ?? project.aspectRatio)),
        ),
        const SizedBox(height: 12),
        Text(
          '${project.scenes.length} scenes · ${project.totalDurationSeconds.round()}s total',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _busy ? null : () => _render(project),
            child: _busy ? const _InlineSpinner() : const Text('Render Video'),
          ),
        ),
        if (_renderStatus != null) ...[
          const SizedBox(height: 12),
          Text(
            _renderStatus!,
            style: const TextStyle(color: AppColors.textSecondary),
          ),
        ],
        if (project.exportedFilePath != null) ...[
          const SizedBox(height: 20),
          const Text(
            'Exported video',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          _exportedPreview(project.exportedFilePath!),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.ios_share, size: 18),
            label: const Text('Share / Save to Photos'),
            onPressed: () => SharePlus.instance.share(
              ShareParams(files: [XFile(project.exportedFilePath!)]),
            ),
          ),
        ],
      ],
    );
  }

  Widget _exportedPreview(String path) {
    return _ExportedVideoPreview(path: path);
  }

  Future<void> _render(VideoProject project) async {
    if (project.scenes.isEmpty) {
      _toast('Add at least one scene first.');
      return;
    }
    setState(() {
      _busy = true;
      _renderStatus = 'Starting…';
    });
    _persist(project.copyWith(status: ProjectStatus.rendering));
    final mediaDir = await ref
        .read(projectStoreProvider)
        .mediaDirFor(project.id);
    final exportsDir = await ref.read(projectStoreProvider).exportsDir();
    final result = await _renderService.render(
      project: project,
      workDir: mediaDir,
      outputDir: exportsDir,
      onStatus: (status) {
        if (mounted) setState(() => _renderStatus = status);
      },
    );
    setState(() => _busy = false);
    if (!result.ok) {
      setState(() => _renderStatus = null);
      _persist(project.copyWith(status: ProjectStatus.failed));
      _toast(result.errorMessage ?? 'Render failed.');
      return;
    }
    setState(() => _renderStatus = 'Done.');
    _persist(
      project.copyWith(
        status: ProjectStatus.exported,
        exportedFilePath: result.outputPath,
      ),
    );
  }
}

class _InlineSpinner extends StatelessWidget {
  const _InlineSpinner();
  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 18,
      width: 18,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
    );
  }
}

class _ExportedVideoPreview extends StatefulWidget {
  final String path;
  const _ExportedVideoPreview({required this.path});

  @override
  State<_ExportedVideoPreview> createState() => _ExportedVideoPreviewState();
}

class _ExportedVideoPreviewState extends State<_ExportedVideoPreview> {
  VideoPlayerController? _controller;

  @override
  void initState() {
    super.initState();
    final controller = VideoPlayerController.file(File(widget.path));
    controller.initialize().then((_) {
      if (mounted) setState(() => _controller = controller);
    });
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) {
      return const SizedBox(
        height: 120,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: AspectRatio(
            aspectRatio: controller.value.aspectRatio == 0
                ? 9 / 16
                : controller.value.aspectRatio,
            child: GestureDetector(
              onTap: () => setState(() {
                controller.value.isPlaying
                    ? controller.pause()
                    : controller.play();
              }),
              child: VideoPlayer(controller),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          p.basename(widget.path),
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
      ],
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
