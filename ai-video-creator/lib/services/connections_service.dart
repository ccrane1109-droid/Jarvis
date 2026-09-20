import '../core/storage/connections_store.dart';
import '../core/utils/ids.dart';
import '../models/connection_config.dart';

class ConnectionsService {
  final ConnectionsStore _store;

  ConnectionsService({ConnectionsStore? store})
    : _store = store ?? ConnectionsStore();

  Future<List<ConnectionConfig>> loadAll() => _store.loadAll();

  Future<List<ConnectionConfig>> add(ConnectionConfig connection) async {
    final all = await _store.loadAll();
    all.add(connection);
    await _store.saveAll(all);
    return all;
  }

  Future<List<ConnectionConfig>> update(ConnectionConfig connection) async {
    final all = await _store.loadAll();
    final index = all.indexWhere((c) => c.id == connection.id);
    if (index == -1) {
      all.add(connection);
    } else {
      all[index] = connection;
    }
    await _store.saveAll(all);
    return all;
  }

  Future<List<ConnectionConfig>> delete(String id) async {
    final all = await _store.loadAll();
    all.removeWhere((c) => c.id == id);
    await _store.saveAll(all);
    return all;
  }

  ConnectionConfig blank(ConnectionKind kind) {
    return ConnectionConfig(
      id: newId('conn'),
      name: ConnectionTemplates.label(kind),
      kind: kind,
      endpointUrl: '',
      bodyTemplate: ConnectionTemplates.bodyTemplateFor(kind),
    );
  }
}
