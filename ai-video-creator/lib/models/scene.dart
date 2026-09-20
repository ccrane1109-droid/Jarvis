import 'caption_line.dart';

enum VisualSourceType { none, localImage, localVideo, generated }

class Scene {
  final String id;
  final String text;
  final String? voiceoverFilePath;
  final double? voiceoverDurationSeconds;
  final VisualSourceType visualType;
  final String? visualPath;
  final List<CaptionLine> captions;

  const Scene({
    required this.id,
    required this.text,
    this.voiceoverFilePath,
    this.voiceoverDurationSeconds,
    this.visualType = VisualSourceType.none,
    this.visualPath,
    this.captions = const [],
  });

  double get effectiveDurationSeconds {
    if (voiceoverDurationSeconds != null && voiceoverDurationSeconds! > 0) {
      return voiceoverDurationSeconds!;
    }
    if (captions.isNotEmpty) {
      final lastEnd = captions.last.end.inMilliseconds / 1000.0;
      if (lastEnd > 0) return lastEnd;
    }
    // Fallback: rough reading-speed estimate (~2.5 words/sec) with a floor.
    final wordCount = text.trim().isEmpty
        ? 0
        : text.trim().split(RegExp(r'\s+')).length;
    final estimate = wordCount / 2.5;
    return estimate < 3 ? 3 : estimate;
  }

  Scene copyWith({
    String? text,
    String? voiceoverFilePath,
    double? voiceoverDurationSeconds,
    VisualSourceType? visualType,
    String? visualPath,
    List<CaptionLine>? captions,
    bool clearVoiceover = false,
    bool clearVisual = false,
  }) {
    return Scene(
      id: id,
      text: text ?? this.text,
      voiceoverFilePath: clearVoiceover
          ? null
          : (voiceoverFilePath ?? this.voiceoverFilePath),
      voiceoverDurationSeconds: clearVoiceover
          ? null
          : (voiceoverDurationSeconds ?? this.voiceoverDurationSeconds),
      visualType: clearVisual
          ? VisualSourceType.none
          : (visualType ?? this.visualType),
      visualPath: clearVisual ? null : (visualPath ?? this.visualPath),
      captions: captions ?? this.captions,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'text': text,
    'voiceoverFilePath': voiceoverFilePath,
    'voiceoverDurationSeconds': voiceoverDurationSeconds,
    'visualType': visualType.name,
    'visualPath': visualPath,
    'captions': captions.map((c) => c.toJson()).toList(),
  };

  factory Scene.fromJson(Map<String, dynamic> json) => Scene(
    id: json['id'] as String,
    text: json['text'] as String? ?? '',
    voiceoverFilePath: json['voiceoverFilePath'] as String?,
    voiceoverDurationSeconds: (json['voiceoverDurationSeconds'] as num?)
        ?.toDouble(),
    visualType: VisualSourceType.values.firstWhere(
      (v) => v.name == json['visualType'],
      orElse: () => VisualSourceType.none,
    ),
    visualPath: json['visualPath'] as String?,
    captions: (json['captions'] as List<dynamic>? ?? [])
        .map((c) => CaptionLine.fromJson(c as Map<String, dynamic>))
        .toList(),
  );
}
