import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage/project_store.dart';
import '../core/utils/ids.dart';
import '../models/video_project.dart';

final projectStoreProvider = Provider<ProjectStore>((ref) => ProjectStore());

class ProjectsNotifier extends AsyncNotifier<List<VideoProject>> {
  @override
  Future<List<VideoProject>> build() {
    return ref.read(projectStoreProvider).loadProjects();
  }

  Future<VideoProject> createProject({
    required String title,
    required String topic,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final project = VideoProject(
      id: newId('proj'),
      title: title,
      topic: topic,
      createdAt: now,
      updatedAt: now,
    );
    final current = List<VideoProject>.from(state.value ?? []);
    current.insert(0, project);
    await ref.read(projectStoreProvider).saveProjects(current);
    state = AsyncValue.data(current);
    return project;
  }

  Future<void> saveProject(VideoProject project) async {
    final current = List<VideoProject>.from(state.value ?? []);
    final index = current.indexWhere((p) => p.id == project.id);
    if (index == -1) {
      current.insert(0, project);
    } else {
      current[index] = project;
    }
    await ref.read(projectStoreProvider).saveProjects(current);
    state = AsyncValue.data(current);
  }

  Future<void> deleteProject(String id) async {
    final current = List<VideoProject>.from(state.value ?? [])
      ..removeWhere((p) => p.id == id);
    await ref.read(projectStoreProvider).saveProjects(current);
    state = AsyncValue.data(current);
  }
}

final projectsProvider =
    AsyncNotifierProvider<ProjectsNotifier, List<VideoProject>>(
      ProjectsNotifier.new,
    );
