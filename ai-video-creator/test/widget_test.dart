import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ai_video_creator/app.dart';

void main() {
  testWidgets('renders the home shell with bottom navigation', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const ProviderScope(child: AiVideoCreatorApp()));
    await tester.pump();

    expect(find.text('Studio'), findsWidgets);
    expect(find.text('Clip Generator'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });
}
