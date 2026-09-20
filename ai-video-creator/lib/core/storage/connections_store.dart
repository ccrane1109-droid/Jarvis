import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../models/connection_config.dart';

/// Persists [ConnectionConfig]s (which include API keys) in the device's
/// secure storage (Keychain on iOS, EncryptedSharedPreferences/Keystore on
/// Android) rather than plain files or SharedPreferences.
class ConnectionsStore {
  static const _key = 'ai_video_creator.connections.v1';
  final FlutterSecureStorage _storage;

  ConnectionsStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  Future<List<ConnectionConfig>> loadAll() async {
    final raw = await _storage.read(key: _key);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => ConnectionConfig.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveAll(List<ConnectionConfig> connections) async {
    final raw = jsonEncode(connections.map((c) => c.toJson()).toList());
    await _storage.write(key: _key, value: raw);
  }
}
