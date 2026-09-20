import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ai_video_creator/core/network/api_client.dart';

void main() {
  group('fillJsonTemplate', () {
    test('escapes quotes and newlines in quoted string placeholders', () {
      final result = fillJsonTemplate('{"prompt": "{{prompt}}"}', {
        'prompt': 'She said "hi"\nnew line',
      });
      final decoded = jsonDecode(result) as Map<String, dynamic>;
      expect(decoded['prompt'], 'She said "hi"\nnew line');
    });

    test('substitutes bare numeric placeholders without quoting', () {
      final result = fillJsonTemplate(
        '{"duration": {{duration}}, "count": {{count}}}',
        {'duration': 5, 'count': 3},
      );
      final decoded = jsonDecode(result) as Map<String, dynamic>;
      expect(decoded['duration'], 5);
      expect(decoded['count'], 3);
    });

    test('handles multiple placeholders in one template', () {
      final result = fillJsonTemplate(
        '{"topic": "{{topic}}", "aspect_ratio": "{{aspectRatio}}", "duration": {{duration}}}',
        {'topic': 'cats', 'aspectRatio': '16:9', 'duration': 8},
      );
      final decoded = jsonDecode(result) as Map<String, dynamic>;
      expect(decoded['topic'], 'cats');
      expect(decoded['aspect_ratio'], '16:9');
      expect(decoded['duration'], 8);
    });
  });

  group('resolveJsonPath', () {
    test('resolves nested map paths', () {
      final json = {
        'data': {
          'output': {'url': 'https://example.com/video.mp4'},
        },
      };
      expect(
        resolveJsonPath(json, 'data.output.url'),
        'https://example.com/video.mp4',
      );
    });

    test('resolves numeric segments into list indices', () {
      final json = {
        'choices': [
          {'message': 'first'},
          {'message': 'second'},
        ],
      };
      expect(resolveJsonPath(json, 'choices.1.message'), 'second');
    });

    test('returns null for a missing path', () {
      final json = {'a': 1};
      expect(resolveJsonPath(json, 'b.c'), isNull);
    });

    test('returns null for an out-of-range list index', () {
      final json = {
        'items': [1, 2],
      };
      expect(resolveJsonPath(json, 'items.5'), isNull);
    });
  });
}
