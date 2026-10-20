import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ManageTicketsScreen extends StatefulWidget {
  const ManageTicketsScreen({super.key});

  @override
  State<ManageTicketsScreen> createState() => _ManageTicketsScreenState();
}

class _ManageTicketsScreenState extends State<ManageTicketsScreen> {
  List<dynamic> _tickets = [];
  bool _isLoading = true;
  String? _error;
  String _filter = 'Tous';

  final List<String> _filters = [
    'Tous',
    'ACTIVE',
    'USED',
    'TRANSFERRED',
    'REFUNDED',
  ];

  @override
  void initState() {
    super.initState();
    _loadTickets();
  }

  Future<void> _loadTickets() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final result = await ApiService.getAllTickets();

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      if (result['success'] == true) {
        _tickets = result['tickets'] ?? [];
      } else {
        _error = result['message'] ?? 'Erreur de chargement';
      }
    });
  }

  List<dynamic> get _filteredTickets {
    if (_filter == 'Tous') return _tickets;
    return _tickets.where((t) => t['status'] == _filter).toList();
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'ACTIVE':
        return Colors.green;
      case 'USED':
        return Colors.grey;
      case 'TRANSFERRED':
        return Colors.blue;
      case 'REFUNDED':
        return Colors.orange;
      default:
        return Colors.black;
    }
  }

  String _getStatusLabel(String status) {
    switch (status) {
      case 'ACTIVE':
        return 'Actif';
      case 'USED':
        return 'Utilisé';
      case 'TRANSFERRED':
        return 'Transféré';
      case 'REFUNDED':
        return 'Remboursé';
      default:
        return status;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gérer les tickets'),
        backgroundColor: Colors.deepOrange,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadTickets,
          ),
        ],
      ),
      body: Column(
        children: [
          // Filtres
          SizedBox(
            height: 50,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _filters.length,
              itemBuilder: (context, index) {
                final f = _filters[index];
                final label = f == 'Tous' ? 'Tous' : _getStatusLabel(f);
                final isSelected = _filter == f;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(label),
                    selected: isSelected,
                    selectedColor: Colors.deepOrange.shade100,
                    onSelected: (_) {
                      setState(() => _filter = f);
                    },
                  ),
                );
              },
            ),
          ),

          // Compteur
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${_filteredTickets.length} ticket(s)',
                style: const TextStyle(color: Colors.grey, fontSize: 13),
              ),
            ),
          ),

          // Liste
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(_error!, style: const TextStyle(color: Colors.red)),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: _loadTickets,
                              child: const Text('Réessayer'),
                            ),
                          ],
                        ),
                      )
                    : _filteredTickets.isEmpty
                        ? const Center(
                            child: Text(
                              'Aucun ticket trouvé',
                              style: TextStyle(color: Colors.grey),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _loadTickets,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(12),
                              itemCount: _filteredTickets.length,
                              itemBuilder: (context, index) {
                                final ticket = _filteredTickets[index];
                                final status = ticket['status'] ?? '';
                                final type = ticket['type'] ?? '';

                                return Card(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 8,
                                    ),
                                    leading: CircleAvatar(
                                      backgroundColor: type == 'Petit-déjeuner'
                                          ? Colors.orange.shade100
                                          : Colors.indigo.shade100,
                                      child: Icon(
                                        type == 'Petit-déjeuner'
                                            ? Icons.free_breakfast
                                            : Icons.restaurant,
                                        color: type == 'Petit-déjeuner'
                                            ? Colors.orange
                                            : Colors.indigo,
                                      ),
                                    ),
                                    title: Text(
                                      type,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    subtitle: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        const SizedBox(height: 4),
                                        Text(
                                          ticket['ticket_code'] ?? '',
                                          style: const TextStyle(
                                            fontSize: 11,
                                            fontFamily: 'monospace',
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          '${ticket['full_name'] ?? 'N/A'} • ${ticket['price']} FCFA',
                                          style: const TextStyle(fontSize: 13),
                                        ),
                                        if (ticket['payment_method'] != null)
                                          Text(
                                            'Paiement : ${ticket['payment_method']}',
                                            style: const TextStyle(
                                              fontSize: 12,
                                              color: Colors.grey,
                                            ),
                                          ),
                                      ],
                                    ),
                                    trailing: Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 10,
                                        vertical: 4,
                                      ),
                                      decoration: BoxDecoration(
                                        color: _getStatusColor(status)
                                            .withOpacity(0.15),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(
                                        _getStatusLabel(status),
                                        style: TextStyle(
                                          color: _getStatusColor(status),
                                          fontWeight: FontWeight.bold,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ),
                                    isThreeLine: true,
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}