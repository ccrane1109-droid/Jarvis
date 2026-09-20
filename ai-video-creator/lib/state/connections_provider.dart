import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection_config.dart';
import '../services/connections_service.dart';

final connectionsServiceProvider = Provider<ConnectionsService>(
  (ref) => ConnectionsService(),
);

class ConnectionsNotifier extends AsyncNotifier<List<ConnectionConfig>> {
  @override
  Future<List<ConnectionConfig>> build() {
    return ref.read(connectionsServiceProvider).loadAll();
  }

  Future<void> upsert(ConnectionConfig connection) async {
    final updated = await ref
        .read(connectionsServiceProvider)
        .update(connection);
    state = AsyncValue.data(updated);
  }

  Future<void> remove(String id) async {
    final updated = await ref.read(connectionsServiceProvider).delete(id);
    state = AsyncValue.data(updated);
  }
}

final connectionsProvider =
    AsyncNotifierProvider<ConnectionsNotifier, List<ConnectionConfig>>(
      ConnectionsNotifier.new,
    );

/// Convenience: connections filtered to a single kind, for step-specific pickers.
final connectionsByKindProvider =
    Provider.family<List<ConnectionConfig>, ConnectionKind>((ref, kind) {
      final all = ref.watch(connectionsProvider).value ?? [];
      return all.where((c) => c.kind == kind).toList();
    });
