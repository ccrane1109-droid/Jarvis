import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../models/connection_config.dart';
import '../../state/connections_provider.dart';
import 'connection_editor_screen.dart';

class SettingsTab extends ConsumerWidget {
  const SettingsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectionsAsync = ref.watch(connectionsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Connections')),
      body: connectionsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load connections: $e')),
        data: (connections) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const _IntroCard(),
              const SizedBox(height: 20),
              for (final kind in ConnectionKind.values) ...[
                _KindSection(
                  kind: kind,
                  connections: connections
                      .where((c) => c.kind == kind)
                      .toList(),
                ),
                const SizedBox(height: 20),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _IntroCard extends StatelessWidget {
  const _IntroCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: const [
                Icon(Icons.info_outline, color: AppColors.accentAlt, size: 20),
                SizedBox(width: 8),
                Text(
                  'Bring your own AI provider',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'This app doesn\'t bundle any AI provider. Connect your own script, voiceover, image, '
              'or video-generation API below — endpoint, key, and request shape are all yours to set. '
              'Your keys are stored in this device\'s secure keychain, never sent anywhere except the '
              'endpoint you configure.',
              style: TextStyle(color: AppColors.textSecondary, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

class _KindSection extends ConsumerWidget {
  final ConnectionKind kind;
  final List<ConnectionConfig> connections;
  const _KindSection({required this.kind, required this.connections});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    ConnectionTemplates.label(kind),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                TextButton.icon(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ConnectionEditorScreen(
                        connection: ref
                            .read(connectionsServiceProvider)
                            .blank(kind),
                        isNew: true,
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add'),
                ),
              ],
            ),
            if (connections.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  'No connection configured yet.',
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              )
            else
              ...connections.map((c) => _ConnectionTile(connection: c)),
          ],
        ),
      ),
    );
  }
}

class _ConnectionTile extends ConsumerWidget {
  final ConnectionConfig connection;
  const _ConnectionTile({required this.connection});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasEndpoint = connection.endpointUrl.trim().isNotEmpty;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(connection.name),
      subtitle: Text(
        hasEndpoint ? connection.endpointUrl : 'Not configured',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: hasEndpoint ? AppColors.textSecondary : AppColors.warning,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.edit_outlined, size: 20),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ConnectionEditorScreen(
                  connection: connection,
                  isNew: false,
                ),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(
              Icons.delete_outline,
              size: 20,
              color: AppColors.textSecondary,
            ),
            onPressed: () =>
                ref.read(connectionsProvider.notifier).remove(connection.id),
          ),
        ],
      ),
    );
  }
}
