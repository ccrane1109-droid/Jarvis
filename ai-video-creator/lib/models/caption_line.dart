class CaptionLine {
  final String id;
  final Duration start;
  final Duration end;
  final String text;

  const CaptionLine({
    required this.id,
    required this.start,
    required this.end,
    required this.text,
  });

  CaptionLine copyWith({Duration? start, Duration? end, String? text}) {
    return CaptionLine(
      id: id,
      start: start ?? this.start,
      end: end ?? this.end,
      text: text ?? this.text,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'startMs': start.inMilliseconds,
    'endMs': end.inMilliseconds,
    'text': text,
  };

  factory CaptionLine.fromJson(Map<String, dynamic> json) => CaptionLine(
    id: json['id'] as String,
    start: Duration(milliseconds: json['startMs'] as int),
    end: Duration(milliseconds: json['endMs'] as int),
    text: json['text'] as String,
  );
}
