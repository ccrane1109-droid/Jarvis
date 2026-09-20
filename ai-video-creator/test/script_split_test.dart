import 'package:flutter_test/flutter_test.dart';
import 'package:ai_video_creator/core/utils/script_split.dart';

void main() {
  group('splitScriptIntoScenes', () {
    test('splits on blank-line-separated paragraphs', () {
      const text =
          'First scene text.\n\nSecond scene text.\n\nThird scene text.';
      final scenes = splitScriptIntoScenes(text, 3);
      expect(scenes, [
        'First scene text.',
        'Second scene text.',
        'Third scene text.',
      ]);
    });

    test('splits on explicit "Scene N" markers', () {
      const text =
          'Scene 1: Intro line here.\nScene 2: Middle line here.\nScene 3: Outro line here.';
      final scenes = splitScriptIntoScenes(text, 3);
      expect(scenes.length, 3);
      expect(scenes[0], contains('Intro line here.'));
      expect(scenes[1], contains('Middle line here.'));
      expect(scenes[2], contains('Outro line here.'));
    });

    test('falls back to an even sentence split when there is no structure', () {
      const text = 'One. Two. Three. Four. Five. Six.';
      final scenes = splitScriptIntoScenes(text, 3);
      expect(scenes.length, 3);
      expect(scenes.join(' '), contains('One.'));
      expect(scenes.join(' '), contains('Six.'));
    });

    test('returns the whole text as a single scene when it is shorter than the target', () {
      const text = 'Just one sentence.';
      final scenes = splitScriptIntoScenes(text, 5);
      expect(scenes, ['Just one sentence.']);
    });

    test('returns an empty list for empty input', () {
      expect(splitScriptIntoScenes('', 5), isEmpty);
    });
  });
}
