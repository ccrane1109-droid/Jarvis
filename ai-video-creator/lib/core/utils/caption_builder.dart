import '../../models/caption_line.dart';
import '../utils/ids.dart';

/// Splits scene narration text into short on-screen caption chunks and
/// distributes a known total duration across them proportionally to each
/// chunk's character count (a simple but reasonable proxy for how long it
/// takes to speak/read a chunk aloud).
List<CaptionLine> buildCaptionsForScene({
  required String text,
  required Duration totalDuration,
  int maxWordsPerLine = 7,
}) {
  final words = text
      .trim()
      .split(RegExp(r'\s+'))
      .where((w) => w.isNotEmpty)
      .toList();
  if (words.isEmpty || totalDuration.inMilliseconds <= 0) return [];

  final chunks = <String>[];
  for (var i = 0; i < words.length; i += maxWordsPerLine) {
    final end = (i + maxWordsPerLine < words.length)
        ? i + maxWordsPerLine
        : words.length;
    chunks.add(words.sublist(i, end).join(' '));
  }

  final totalChars = chunks.fold<int>(0, (sum, c) => sum + c.length);
  if (totalChars == 0) return [];

  final lines = <CaptionLine>[];
  var elapsedMs = 0;
  for (var i = 0; i < chunks.length; i++) {
    final chunk = chunks[i];
    final isLast = i == chunks.length - 1;
    final shareMs = isLast
        ? totalDuration.inMilliseconds - elapsedMs
        : ((chunk.length / totalChars) * totalDuration.inMilliseconds).round();
    final start = Duration(milliseconds: elapsedMs);
    final end = Duration(milliseconds: elapsedMs + shareMs);
    lines.add(
      CaptionLine(id: newId('cap'), start: start, end: end, text: chunk),
    );
    elapsedMs += shareMs;
  }
  return lines;
}

/// Formats a list of per-scene caption tracks (already offset to a shared
/// timeline by the caller) as an SRT subtitle file.
String captionsToSrt(List<CaptionLine> lines) {
  final buffer = StringBuffer();
  for (var i = 0; i < lines.length; i++) {
    final line = lines[i];
    buffer.writeln(i + 1);
    buffer.writeln(
      '${_srtTimestamp(line.start)} --> ${_srtTimestamp(line.end)}',
    );
    buffer.writeln(line.text);
    buffer.writeln();
  }
  return buffer.toString();
}

String _srtTimestamp(Duration d) {
  String two(int n) => n.toString().padLeft(2, '0');
  String three(int n) => n.toString().padLeft(3, '0');
  final hours = d.inHours;
  final minutes = d.inMinutes.remainder(60);
  final seconds = d.inSeconds.remainder(60);
  final millis = d.inMilliseconds.remainder(1000);
  return '${two(hours)}:${two(minutes)}:${two(seconds)},${three(millis)}';
}

/// Offsets a scene's local caption lines by [offset] so multiple scenes'
/// captions can be concatenated onto one project-wide timeline.
List<CaptionLine> offsetCaptions(List<CaptionLine> lines, Duration offset) {
  return lines
      .map(
        (l) => CaptionLine(
          id: l.id,
          start: l.start + offset,
          end: l.end + offset,
          text: l.text,
        ),
      )
      .toList();
}
