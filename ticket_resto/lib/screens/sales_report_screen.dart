import 'package:flutter/material.dart';
import '../services/api_service.dart';

class SalesReportScreen extends StatefulWidget {
  const SalesReportScreen({super.key});

  @override
  State<SalesReportScreen> createState() => _SalesReportScreenState();
}

class _SalesReportScreenState extends State<SalesReportScreen> {
  Map<String, dynamic>? _report;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadReport();
  }

  Future<void> _loadReport() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final result = await ApiService.getSalesReport();

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      if (result['success'] == true) {
        _report = result['report'];
      } else {
        _error = result['message'] ?? 'Erreur de chargement';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Rapport des ventes'),
        backgroundColor: Colors.teal,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadReport,
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
                        onPressed: _loadReport,
                        child: const Text('Réessayer'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadReport,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _sectionTitle('Aujourd\'hui'),
                      _statCard(
                        Icons.today,
                        'Tickets validés',
                        '${_report?['today']?['count'] ?? 0}',
                        Colors.teal,
                      ),
                      _statCard(
                        Icons.attach_money,
                        'Montant',
                        '${_report?['today']?['total'] ?? 0} FCFA',
                        Colors.green,
                      ),

                      const SizedBox(height: 16),
                      _sectionTitle('Total (tous les temps)'),
                      _statCard(
                        Icons.confirmation_number,
                        'Tickets utilisés',
                        '${_report?['totals']?['total_used'] ?? 0}',
                        Colors.indigo,
                      ),
                      _statCard(
                        Icons.payments,
                        'Montant total',
                        '${_report?['totals']?['total_amount'] ?? 0} FCFA',
                        Colors.deepOrange,
                      ),

                      const SizedBox(height: 16),
                      _sectionTitle('Par type de ticket'),
                      ..._buildTypeList(_report?['by_type']),

                      const SizedBox(height: 16),
                      _sectionTitle('7 derniers jours'),
                      ..._buildDayList(_report?['by_day']),

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
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
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

  List<Widget> _buildTypeList(dynamic data) {
    if (data == null || data is! List || data.isEmpty) {
      return [
        const Text('Aucune donnée', style: TextStyle(color: Colors.grey)),
      ];
    }
    return data.map<Widget>((item) {
      return Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          title: Text(item['type']?.toString() ?? ''),
          subtitle: Text('${item['count']} ticket(s)'),
          trailing: Text(
            '${item['total'] ?? 0} FCFA',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
      );
    }).toList();
  }

  List<Widget> _buildDayList(dynamic data) {
    if (data == null || data is! List || data.isEmpty) {
      return [
        const Text('Aucune donnée', style: TextStyle(color: Colors.grey)),
      ];
    }
    return data.map<Widget>((item) {
      final day = item['day']?.toString() ?? '';
      return Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          title: Text(day),
          subtitle: Text('${item['count']} ticket(s)'),
          trailing: Text(
            '${item['total'] ?? 0} FCFA',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
      );
    }).toList();
  }
}