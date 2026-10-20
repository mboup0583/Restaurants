import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Map<String, dynamic>? _stats;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final result = await ApiService.getStats();

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      if (result['success'] == true) {
        _stats = result['stats'];
      } else {
        _error = result['message'] ?? 'Erreur de chargement';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Rapports'),
        backgroundColor: Colors.deepOrange,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadStats,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadStats,
                        child: const Text('Réessayer'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadStats,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Revenus
                      _sectionTitle('Revenus'),
                      _statCard(
                        Icons.attach_money,
                        'Ventes totales',
                        '${_stats?['revenue']?['total_sales'] ?? 0} FCFA',
                        Colors.green,
                      ),
                      _statCard(
                        Icons.money_off,
                        'Remboursements',
                        '${_stats?['revenue']?['total_refunded'] ?? 0} FCFA',
                        Colors.orange,
                      ),
                      _statCard(
                        Icons.confirmation_number,
                        'Total tickets',
                        '${_stats?['revenue']?['total_tickets'] ?? 0}',
                        Colors.indigo,
                      ),
                      _statCard(
                        Icons.calendar_today,
                        'Tickets (7 derniers jours)',
                        '${_stats?['tickets_last_7_days'] ?? 0}',
                        Colors.teal,
                      ),

                      const SizedBox(height: 20),
                      _sectionTitle('Tickets par statut'),
                      ..._buildList(_stats?['tickets_by_status'], 'status',
                          (s) {
                        switch (s) {
                          case 'ACTIVE':
                            return 'Actifs';
                          case 'USED':
                            return 'Utilisés';
                          case 'TRANSFERRED':
                            return 'Transférés';
                          case 'REFUNDED':
                            return 'Remboursés';
                          default:
                            return s;
                        }
                      }),

                      const SizedBox(height: 20),
                      _sectionTitle('Tickets par type'),
                      ..._buildList(_stats?['tickets_by_type'], 'type', (t) => t),

                      const SizedBox(height: 20),
                      _sectionTitle('Utilisateurs par rôle'),
                      ..._buildList(
                          _stats?['users_by_type'], 'user_type', (t) => t),

                      const SizedBox(height: 30),
                    ],
                  ),
                ),
    );
  }

  Widget _sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12, top: 8),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _statCard(IconData icon, String label, String value, Color color) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.15),
          child: Icon(icon, color: color),
        ),
        title: Text(label),
        trailing: Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 16,
            color: color,
          ),
        ),
      ),
    );
  }

  List<Widget> _buildList(
    dynamic data,
    String keyField,
    String Function(String) labelFn,
  ) {
    if (data == null || data is! List || data.isEmpty) {
      return [
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text('Aucune donnée', style: TextStyle(color: Colors.grey)),
        ),
      ];
    }

    return data.map<Widget>((item) {
      final key = item[keyField]?.toString() ?? '';
      final count = item['count']?.toString() ?? '0';
      final total = item['total'];

      return Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          title: Text(labelFn(key)),
          trailing: Text(
            total != null ? '$count (${total} FCFA)' : count,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
      );
    }).toList();
  }
}