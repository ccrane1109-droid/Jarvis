import 'package:flutter_test/flutter_test.dart';
import 'package:ai_video_creator/core/utils/caption_builder.dart';
import 'package:ai_video_creator/models/caption_line.dart';

void main() {
  group('buildCaptionsForScene', () {
    test('splits text into chunks of at most maxWordsPerLine words', () {
      const text = 'one two three four five six seven eight nine';
      final captions = buildCaptionsForScene(
        text: text,
        totalDuration: const Duration(seconds: 9),
        maxWordsPerLine: 3,
      );
      expect(captions.length, 3);
      expect(captions[0].text, 'one two three');
      expect(captions[1].text, 'four five six');
      expect(captions[2].text, 'seven eight nine');
    });

    test('caption timestamps are contiguous and cover the full duration', () {
      const text = 'a b c d e f';
      final total = Duration(seconds: 6);
      final captions = buildCaptionsForScene(
        text: text,
        totalDuration: total,
        maxWordsPerLine: 2,
      );
      expect(captions.first.start, Duration.zero);
      expect(captions.last.end, total);
      for (var i = 1; i < captions.length; i++) {
        expect(captions[i].start, captions[i - 1].end);
      }
    });

    test('returns an empty list for empty text or zero duration', () {
      expect(
        buildCaptionsForScene(
          text: '',
          totalDuration: const Duration(seconds: 5),
        ),
        isEmpty,
      );
      expect(
        buildCaptionsForScene(
          text: 'hello world',
          totalDuration: Duration.zero,
        ),
        isEmpty,
      );
    });
  });

  group('captionsToSrt', () {
    test('formats lines with 1-based index and SRT timestamps', () {
      final lines = [
        const CaptionLine(
          id: '1',
          start: Duration.zero,
          end: Duration(seconds: 2),
          text: 'Hello',
        ),
        const CaptionLine(
          id: '2',
          start: Duration(seconds: 2),
          end: Duration(seconds: 4, milliseconds: 500),
          text: 'World',
        ),
      ];
      final srt = captionsToSrt(lines);
      expect(srt, contains('1\n00:00:00,000 --> 00:00:02,000\nHello'));
      expect(srt, contains('2\n00:00:02,000 --> 00:00:04,500\nWorld'));
    });
  });

  group('offsetCaptions', () {
    test('shifts start and end by the given offset', () {
      final lines = [
        const CaptionLine(
          id: '1',
          start: Duration.zero,
          end: Duration(seconds: 2),
          text: 'Hi',
        ),
      ];
      final offset = offsetCaptions(lines, const Duration(seconds: 10));
      expect(offset.single.start, const Duration(seconds: 10));
      expect(offset.single.end, const Duration(seconds: 12));
    });
  });
}
