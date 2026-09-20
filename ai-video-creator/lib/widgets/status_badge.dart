import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';

class StatusBadge extends StatelessWidget {
  final String label;
  final Color color;

  const StatusBadge({super.key, required this.label, required this.color});

  factory StatusBadge.success(String label) =>
      StatusBadge(label: label, color: AppColors.success);
  factory StatusBadge.danger(String label) =>
      StatusBadge(label: label, color: AppColors.danger);
  factory StatusBadge.neutral(String label) =>
      StatusBadge(label: label, color: AppColors.textSecondary);
  factory StatusBadge.warning(String label) =>
      StatusBadge(label: label, color: AppColors.warning);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
