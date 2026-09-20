import 'package:flutter/material.dart';

import 'core/theme/app_theme.dart';
import 'features/home/home_shell.dart';

class AiVideoCreatorApp extends StatelessWidget {
  const AiVideoCreatorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI Video Creator',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const HomeShell(),
    );
  }
}
