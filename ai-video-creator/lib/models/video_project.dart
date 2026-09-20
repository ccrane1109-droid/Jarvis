import 'scene.dart';

enum ProjectStatus { draft, rendering, exported, failed }

class VideoProject {
  final String id;
  final String title;
  final String topic;
  final int createdAt;
  final int updatedAt;
  final List<Scene> scenes;
  final String? musicFilePath;
  final double musicVolume;
  final String aspectRatio;
  final String? exportedFilePath;
  final ProjectStatus status;

  const VideoProject({
    required this.id,
    required this.title,
    required this.topic,
    required this.createdAt,
    required this.updatedAt,
    this.scenes = const [],
    this.musicFilePath,
    this.musicVolume = 0.25,
    this.aspectRatio = '9:16',
    this.exportedFilePath,
    this.status = ProjectStatus.draft,
  });

  double get totalDurationSeconds =>
      scenes.fold(0.0, (sum, s) => sum + s.effectiveDurationSeconds);

  VideoProject copyWith({
    String? title,
    String? topic,
    int? updatedAt,
    List<Scene>? scenes,
    String? musicFilePath,
    double? musicVolume,
    String? aspectRatio,
    String? exportedFilePath,
    ProjectStatus? status,
    bool clearMusic = false,
  }) {
    return VideoProject(
      id: id,
      title: title ?? this.title,
      topic: topic ?? this.topic,
      createdAt: createdAt,
      updatedAt: updatedAt ?? DateTime.now().millisecondsSinceEpoch,
      scenes: scenes ?? this.scenes,
      musicFilePath: clearMusic ? null : (musicFilePath ?? this.musicFilePath),
      musicVolume: musicVolume ?? this.musicVolume,
      aspectRatio: aspectRatio ?? this.aspectRatio,
      exportedFilePath: exportedFilePath ?? this.exportedFilePath,
      status: status ?? this.status,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'topic': topic,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
    'scenes': scenes.map((s) => s.toJson()).toList(),
    'musicFilePath': musicFilePath,
    'musicVolume': musicVolume,
    'aspectRatio': aspectRatio,
    'exportedFilePath': exportedFilePath,
    'status': status.name,
  };

  factory VideoProject.fromJson(Map<String, dynamic> json) => VideoProject(
    id: json['id'] as String,
    title: json['title'] as String? ?? 'Untitled',
    topic: json['topic'] as String? ?? '',
    createdAt: json['createdAt'] as int,
    updatedAt: json['updatedAt'] as int,
    scenes: (json['scenes'] as List<dynamic>? ?? [])
        .map((s) => Scene.fromJson(s as Map<String, dynamic>))
        .toList(),
    musicFilePath: json['musicFilePath'] as String?,
    musicVolume: (json['musicVolume'] as num?)?.toDouble() ?? 0.25,
    aspectRatio: json['aspectRatio'] as String? ?? '9:16',
    exportedFilePath: json['exportedFilePath'] as String?,
    status: ProjectStatus.values.firstWhere(
      (v) => v.name == json['status'],
      orElse: () => ProjectStatus.draft,
    ),
  );
}
