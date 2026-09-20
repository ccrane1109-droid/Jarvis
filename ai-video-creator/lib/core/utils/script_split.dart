/// Splits a block of generated script text into per-scene chunks.
///
/// AI script-generation responses vary a lot in shape, so this applies a
/// few heuristics in order and falls back gracefully rather than crashing
/// on unexpected formatting:
///  1. Blank-line-separated paragraphs (most common for prose scripts).
///  2. Lines that look like explicit scene markers ("Scene 1", "1)", "1.").
///  3. An even split across sentences, targeting [targetSceneCount] scenes.
List<String> splitScriptIntoScenes(String rawText, int targetSceneCount) {
  final text = rawText.trim();
  if (text.isEmpty) return [];
  final target = targetSceneCount < 1 ? 1 : targetSceneCount;

  final byBlankLine = text
      .split(RegExp(r'\n\s*\n'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  if (byBlankLine.length > 1) {
    return _stripSceneMarkers(byBlankLine);
  }

  final sceneMarker = RegExp(
    r'^\s*(scene\s*\d+[:.\-]?|\d+[.)])\s*',
    caseSensitive: false,
  );
  final lines = text.split('\n');
  final markedChunks = <String>[];
  final buffer = StringBuffer();
  for (final line in lines) {
    if (sceneMarker.hasMatch(line)) {
      if (buffer.toString().trim().isNotEmpty) {
        markedChunks.add(buffer.toString().trim());
        buffer.clear();
      }
      buffer.writeln(line.replaceFirst(sceneMarker, ''));
    } else {
      buffer.writeln(line);
    }
  }
  if (buffer.toString().trim().isNotEmpty) {
    markedChunks.add(buffer.toString().trim());
  }
  if (markedChunks.length > 1) return markedChunks;

  final sentences = text
      .split(RegExp(r'(?<=[.!?])\s+'))
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  if (sentences.isEmpty) return [text];
  if (sentences.length <= target) return sentences;

  final perScene = (sentences.length / target).ceil();
  final result = <String>[];
  for (var i = 0; i < sentences.length; i += perScene) {
    final end = (i + perScene < sentences.length)
        ? i + perScene
        : sentences.length;
    result.add(sentences.sublist(i, end).join(' '));
  }
  return result;
}

List<String> _stripSceneMarkers(List<String> chunks) {
  final marker = RegExp(r'^\s*(scene\s*\d+[:.\-]?)\s*', caseSensitive: false);
  return chunks.map((c) => c.replaceFirst(marker, '').trim()).toList();
}
