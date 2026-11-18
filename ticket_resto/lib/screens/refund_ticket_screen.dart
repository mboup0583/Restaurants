import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class RefundTicketScreen extends StatefulWidget {
  const RefundTicketScreen({super.key});

  @override
  State<RefundTicketScreen> createState() => _RefundTicketScreenState();
}

class _RefundTicketScreenState extends State<RefundTicketScreen> {
  List<dynamic> _activeTickets = [];
  bool _isLoading = true;
  bool _isRefunding = false;
  String? _error;
  final Set<int> _selectedTicketIds = {};
  String _selectedPayment = 'Wave';
  final List<String> _paymentMethods = ['Wave', 'Orange Money'];

  @override
  void initState() {
    super.initState();
    _loadActiveTickets();
  }

  Future<void> _loadActiveTickets() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final result = await ApiService.getMyTickets(authProvider.currentUser!.id);

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      if (result['success'] == true) {
        _activeTickets = (result['tickets'] as List)
            .where((t) => t['status'] == 'ACTIVE')
            .toList();
      } else {
        _error = result['message'] ?? 'Erreur de chargement';
      }
    });
  }

  void _toggleTicket(int ticketId) {
    setState(() {
      if (_selectedTicketIds.contains(ticketId)) {
        _selectedTicketIds.remove(ticketId);
      } else {
        _selectedTicketIds.add(ticketId);
      }
    });
  }

  void _toggleSelectAll() {
    setState(() {
      if (_selectedTicketIds.length == _activeTickets.length) {
        _selectedTicketIds.clear();
      } else {
        _selectedTicketIds.clear();
        for (final t in _activeTickets) {
          _selectedTicketIds.add(t['id'] as int);
        }
      }
    });
  }

  double _calculateTotalSelected() {
    double total = 0;
    for (final t in _activeTickets) {
      if (_selectedTicketIds.contains(t['id'])) {
        total += (double.tryParse(t['price'].toString()) ?? 0);
      }
    }
    return total;
  }

  Future<void> _handleRefund() async {
    if (_selectedTicketIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Sélectionnez au moins un ticket à rembourser'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    setState(() => _isRefunding = true);

    try {
      final userId = Provider.of<AuthProvider>(context, listen: false).currentUser!.id;
      final result = await ApiService.refundTickets(
        userId: userId,
        ticketIds: _selectedTicketIds.toList(),
        paymentMethod: _selectedPayment,
      );

      if (!mounted) return;

      if (result['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Demande de remboursement enregistrée'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop(true);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Erreur lors du remboursement'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur : $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isRefunding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final allSelected = _activeTickets.isNotEmpty && _selectedTicketIds.length == _activeTickets.length;
    final totalSelected = _calculateTotalSelected();

    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        title: const Text('Demander un remboursement'),
        backgroundColor: Colors.deepOrange,
        foregroundColor: Colors.white,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: _stepTitle(
                              '1',
                              'Sélectionnez les tickets (${_selectedTicketIds.length}/${_activeTickets.length})',
                            ),
                          ),
                          if (_activeTickets.isNotEmpty)
                            TextButton.icon(
                              onPressed: _toggleSelectAll,
                              icon: Icon(
                                allSelected ? Icons.check_box : Icons.check_box_outline_blank,
                                size: 18,
                                color: Colors.deepOrange,
                              ),
                              label: Text(
                                allSelected ? 'Tout désélectionner' : 'Tout cocher',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: Colors.deepOrange,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      if (_selectedTicketIds.isNotEmpty)
                        Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: BoxDecoration(
                            color: Colors.deepOrange.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Colors.deepOrange.withOpacity(0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.money_off, size: 20, color: Colors.deepOrange),
                              const SizedBox(width: 10),
                              Text(
                                '${_selectedTicketIds.length} ticket(s) sélectionné(s) • Total: ${totalSelected.toStringAsFixed(0)} FCFA',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: Colors.deepOrange,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),

                      if (_activeTickets.isEmpty)
                        _emptyBox('Aucun ticket actif à rembourser')
                      else
                        ..._activeTickets.map((ticket) {
                          final ticketId = ticket['id'] as int;
                          final selected = _selectedTicketIds.contains(ticketId);
                          final isPdj = ticket['type'] == 'Petit-déjeuner';
                          final color = isPdj ? Colors.orange : Colors.deepOrange;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            decoration: BoxDecoration(
                              color: selected ? color.withOpacity(0.08) : Colors.white,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: selected ? color : Colors.transparent, width: 2),
                              boxShadow: [
                                BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 8, offset: const Offset(0, 2)),
                              ],
                            ),
                            child: ListTile(
                              onTap: () => _toggleTicket(ticketId),
                              leading: CircleAvatar(
                                backgroundColor: color.withOpacity(0.15),
                                child: Icon(isPdj ? Icons.free_breakfast : Icons.restaurant, color: color),
                              ),
                              title: Row(
                                children: [
                                  Text(ticket['type'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                                  const SizedBox(width: 8),
                                  Text(
                                    '#${ticket['id']}',
                                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                                  ),
                                ],
                              ),
                              subtitle: Text('${ticket['price']} FCFA • Code: ${ticket['ticket_code']}'),
                              trailing: Icon(
                                selected ? Icons.check_box : Icons.check_box_outline_blank,
                                color: selected ? color : Colors.grey.shade400,
                                size: 26,
                              ),
                            ),
                          );
                        }),

                      const SizedBox(height: 28),
                      _stepTitle('2', 'Moyen de réception du remboursement'),
                      const SizedBox(height: 12),
                      ..._paymentMethods.map((method) {
                        final selected = _selectedPayment == method;
                        return Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: selected ? Colors.deepOrange : Colors.transparent, width: 2),
                            boxShadow: [
                              BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 6, offset: const Offset(0, 2)),
                            ],
                          ),
                          child: RadioListTile<String>(
                            title: Text(
                              method,
                              style: TextStyle(fontWeight: selected ? FontWeight.w600 : FontWeight.normal),
                            ),
                            value: method,
                            groupValue: _selectedPayment,
                            activeColor: Colors.deepOrange,
                            onChanged: (v) => setState(() => _selectedPayment = v!),
                          ),
                        );
                      }),

                      const SizedBox(height: 28),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: (_isRefunding || _selectedTicketIds.isEmpty) ? null : _handleRefund,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.deepOrange,
                            foregroundColor: Colors.white,
                            disabledBackgroundColor: Colors.grey.shade300,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: _isRefunding
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                                )
                              : Text(
                                  _selectedTicketIds.isEmpty
                                      ? 'Sélectionnez un ou plusieurs tickets'
                                      : _selectedTicketIds.length == 1
                                          ? 'Demander le remboursement (${totalSelected.toStringAsFixed(0)} FCFA)'
                                          : 'Rembourser les ${_selectedTicketIds.length} tickets (${totalSelected.toStringAsFixed(0)} FCFA)',
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                                ),
                        ),
                      ),
                      const SizedBox(height: 30),
                    ],
                  ),
                ),
    );
  }

  Widget _stepTitle(String num, String text) {
    return Row(
      children: [
        CircleAvatar(
          radius: 14,
          backgroundColor: Colors.deepOrange,
          child: Text(num, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
        ),
      ],
    );
  }

  Widget _emptyBox(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(text, textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade600)),
    );
  }
}
