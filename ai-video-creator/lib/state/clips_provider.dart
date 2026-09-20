import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/generated_clip.dart';
import 'projects_provider.dart' show projectStoreProvider;

class ClipsNotifier extends AsyncNotifier<List<GeneratedClip>> {
  @override
  Future<List<GeneratedClip>> build() {
    return ref.read(projectStoreProvider).loadClips();
  }

  Future<void> add(GeneratedClip clip) async {
    final current = List<GeneratedClip>.from(state.value ?? []);
    current.insert(0, clip);
    await ref.read(projectStoreProvider).saveClips(current);
    state = AsyncValue.data(current);
  }

  Future<void> updateClip(GeneratedClip clip) async {
    final current = List<GeneratedClip>.from(state.value ?? []);
    final index = current.indexWhere((c) => c.id == clip.id);
    if (index != -1) current[index] = clip;
    await ref.read(projectStoreProvider).saveClips(current);
    state = AsyncValue.data(current);
  }

  Future<void> remove(String id) async {
    final current = List<GeneratedClip>.from(state.value ?? [])
      ..removeWhere((c) => c.id == id);
    await ref.read(projectStoreProvider).saveClips(current);
    state = AsyncValue.data(current);
  }
}

final clipsProvider = AsyncNotifierProvider<ClipsNotifier, List<GeneratedClip>>(
  ClipsNotifier.new,
);
