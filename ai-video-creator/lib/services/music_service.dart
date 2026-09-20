import 'package:file_picker/file_picker.dart';

class MusicService {
  Future<String?> pickLocalMusic() async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'],
    );
    return file?.path;
  }
}
