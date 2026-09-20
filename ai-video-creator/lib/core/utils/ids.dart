import 'package:uuid/uuid.dart';

const _uuid = Uuid();

String newId([String? prefix]) {
  final id = _uuid.v4();
  return prefix == null ? id : '${prefix}_$id';
}
