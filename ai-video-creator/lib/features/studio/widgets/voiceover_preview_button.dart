import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';

class VoiceoverPreviewButton extends StatefulWidget {
  final String filePath;
  const VoiceoverPreviewButton({super.key, required this.filePath});

  @override
  State<VoiceoverPreviewButton> createState() => _VoiceoverPreviewButtonState();
}

class _VoiceoverPreviewButtonState extends State<VoiceoverPreviewButton> {
  final _player = AudioPlayer();
  bool _isPlaying = false;

  @override
  void initState() {
    super.initState();
    _player.onPlayerStateChanged.listen((state) {
      if (mounted) setState(() => _isPlaying = state == PlayerState.playing);
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_isPlaying) {
      await _player.pause();
    } else {
      await _player.play(DeviceFileSource(widget.filePath));
    }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(
        _isPlaying ? Icons.pause_circle_outline : Icons.play_circle_outline,
      ),
      onPressed: _toggle,
    );
  }
}
