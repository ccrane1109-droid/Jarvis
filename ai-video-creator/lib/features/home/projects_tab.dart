import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../models/video_project.dart';
import '../../state/projects_provider.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/status_badge.dart';
import '../studio/studio_editor_screen.dart';

class ProjectsTab extends ConsumerWidget {
  const ProjectsTab({super.key});

  Future<void> _createProject(BuildContext context, WidgetRef ref) async {
    final titleController = TextEditingController();
    final topicController = TextEditingController();
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New video project'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: titleController,
              decoration: const InputDecoration(labelText: 'Project title'),
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: topicController,
              decoration: const InputDecoration(
                labelText: 'Video topic / idea',
                hintText: 'e.g. 5 productivity habits for remote workers',
              ),
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    if (created != true) return;
    final title = titleController.text.trim().isEmpty
        ? 'Untitled video'
        : titleController.text.trim();
    final topic = topicController.text.trim();
    final project = await ref
        .read(projectsProvider.notifier)
        .createProject(title: title, topic: topic);
    if (!context.mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => StudioEditorScreen(projectId: project.id),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(projectsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Studio'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'New project',
            onPressed: () => _createProject(context, ref),
          ),
        ],
      ),
      body: projectsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load projects: $e')),
        data: (projects) {
          if (projects.isEmpty) {
            return Center(
              child: EmptyState(
                icon: Icons.movie_creation_outlined,
                title: 'No projects yet',
                message: 'Create a project to turn a topic into a full narrated, captioned video.',
                action: ElevatedButton.icon(
                  onPressed: () => _createProject(context, ref),
                  icon: const Icon(Icons.add),
                  label: const Text('New Project'),
                ),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: projects.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, index) =>
                _ProjectCard(project: projects[index]),
          );
        },
      ),
    );
  }
}

class _ProjectCard extends ConsumerWidget {
  final VideoProject project;
  const _ProjectCard({required this.project});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => StudioEditorScreen(projectId: project.id),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      project.title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      project.topic.isEmpty ? 'No topic set' : project.topic,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        _statusBadge(project.status),
                        const SizedBox(width: 8),
                        Text(
                          '${project.scenes.length} scene${project.scenes.length == 1 ? '' : 's'} · ${project.totalDurationSeconds.round()}s',
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(
                  Icons.delete_outline,
                  color: AppColors.textSecondary,
                ),
                onPressed: () => ref
                    .read(projectsProvider.notifier)
                    .deleteProject(project.id),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusBadge(ProjectStatus status) {
    switch (status) {
      case ProjectStatus.exported:
        return StatusBadge.success('Exported');
      case ProjectStatus.rendering:
        return StatusBadge.warning('Rendering');
      case ProjectStatus.failed:
        return StatusBadge.danger('Failed');
      case ProjectStatus.draft:
        return StatusBadge.neutral('Draft');
    }
  }
}
