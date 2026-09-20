import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../models/video_project.dart';
import '../../models/generated_clip.dart';

/// Persists [VideoProject]s and [GeneratedClip]s as JSON files under the
/// app's documents directory. Media files (images/audio/video) referenced
/// by a project live alongside them as plain files on disk; only metadata
/// goes through this store.
class ProjectStore {
  Future<Directory> _appDir() async {
    final dir = await getApplicationDocumentsDirectory();
    final target = Directory('${dir.path}/ai_video_creator');
    if (!await target.exists()) {
      await target.create(recursive: true);
    }
    return target;
  }

  Future<Directory> mediaDirFor(String projectId) async {
    final base = await _appDir();
    final dir = Directory('${base.path}/media/$projectId');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  Future<Directory> exportsDir() async {
    final base = await _appDir();
    final dir = Directory('${base.path}/exports');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  Future<File> _projectsFile() async {
    final dir = await _appDir();
    return File('${dir.path}/projects.json');
  }

  Future<File> _clipsFile() async {
    final dir = await _appDir();
    return File('${dir.path}/clips.json');
  }

  Future<List<VideoProject>> loadProjects() async {
    final file = await _projectsFile();
    if (!await file.exists()) return [];
    try {
      final raw = await file.readAsString();
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => VideoProject.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveProjects(List<VideoProject> projects) async {
    final file = await _projectsFile();
    await file.writeAsString(
      jsonEncode(projects.map((p) => p.toJson()).toList()),
    );
  }

  Future<List<GeneratedClip>> loadClips() async {
    final file = await _clipsFile();
    if (!await file.exists()) return [];
    try {
      final raw = await file.readAsString();
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => GeneratedClip.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveClips(List<GeneratedClip> clips) async {
    final file = await _clipsFile();
    await file.writeAsString(jsonEncode(clips.map((c) => c.toJson()).toList()));
  }
}
