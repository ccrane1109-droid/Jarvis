enum ClipStatus { pending, success, error }

class GeneratedClip {
  final String id;
  final String prompt;
  final String aspectRatio;
  final int durationSeconds;
  final ClipStatus status;
  final String? videoUrl;
  final String? localFilePath;
  final String? errorMessage;
  final int createdAt;

  const GeneratedClip({
    required this.id,
    required this.prompt,
    required this.aspectRatio,
    required this.durationSeconds,
    required this.createdAt,
    this.status = ClipStatus.pending,
    this.videoUrl,
    this.localFilePath,
    this.errorMessage,
  });

  GeneratedClip copyWith({
    ClipStatus? status,
    String? videoUrl,
    String? localFilePath,
    String? errorMessage,
  }) {
    return GeneratedClip(
      id: id,
      prompt: prompt,
      aspectRatio: aspectRatio,
      durationSeconds: durationSeconds,
      createdAt: createdAt,
      status: status ?? this.status,
      videoUrl: videoUrl ?? this.videoUrl,
      localFilePath: localFilePath ?? this.localFilePath,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'prompt': prompt,
    'aspectRatio': aspectRatio,
    'durationSeconds': durationSeconds,
    'status': status.name,
    'videoUrl': videoUrl,
    'localFilePath': localFilePath,
    'errorMessage': errorMessage,
    'createdAt': createdAt,
  };

  factory GeneratedClip.fromJson(Map<String, dynamic> json) => GeneratedClip(
    id: json['id'] as String,
    prompt: json['prompt'] as String? ?? '',
    aspectRatio: json['aspectRatio'] as String? ?? '16:9',
    durationSeconds: json['durationSeconds'] as int? ?? 5,
    createdAt: json['createdAt'] as int,
    status: ClipStatus.values.firstWhere(
      (s) => s.name == json['status'],
      orElse: () => ClipStatus.pending,
    ),
    videoUrl: json['videoUrl'] as String?,
    localFilePath: json['localFilePath'] as String?,
    errorMessage: json['errorMessage'] as String?,
  );
}
