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
  int? _selectedTicketId;
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

  Future<void> _handleRefund() async {
    if (_selectedTicketId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sélectionnez un ticket'), backgroundColor: Colors.orange),
      );
      return;
    }

    setState(() => _isRefunding = true);

    try {
      final userId = Provider.of<AuthProvider>(context, listen: false).currentUser!.id;
      final result = await ApiService.refundTicket(
        userId: userId,
        ticketId: _selectedTicketId!,
        paymentMethod: _selectedPayment,
      );

      if (!mounted) return;

      if (result['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result['message']), backgroundColor: Colors.green),
        );
        Navigator.of(context).pop();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result['message']), backgroundColor: Colors.red),
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
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        title: const Text('Demander un remboursement'),
        backgroundColor: Colors.indigo,
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
                      _stepTitle('1', 'Choisissez un ticket actif'),
                      const SizedBox(height: 12),
                      if (_activeTickets.isEmpty)
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(20),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Text(
                            'Aucun ticket actif à rembourser',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.grey.shade600),
                          ),
                        )
                      else
                        ..._activeTickets.map((ticket) {
                          final selected = _selectedTicketId == ticket['id'];
                          final isPdj = ticket['type'] == 'Petit-déjeuner';
                          final color = isPdj ? Colors.orange : Colors.indigo;
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
                              onTap: () => setState(() => _selectedTicketId = ticket['id']),
                              leading: CircleAvatar(
                                backgroundColor: color.withOpacity(0.15),
                                child: Icon(isPdj ? Icons.free_breakfast : Icons.restaurant, color: color),
                              ),
                              title: Text(ticket['type'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                              subtitle: Text('${ticket['price']} FCFA'),
                              trailing: selected ? Icon(Icons.check_circle, color: color) : null,
                            ),
                          );
                        }),

                      const SizedBox(height: 28),
                      _stepTitle('2', 'Moyen de remboursement'),
                      const SizedBox(height: 12),
                      ..._paymentMethods.map((method) {
                        final selected = _selectedPayment == method;
                        return Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: selected ? Colors.indigo : Colors.transparent, width: 2),
                            boxShadow: [
                              BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 6, offset: const Offset(0, 2)),
                            ],
                          ),
                          child: RadioListTile<String>(
                            title: Text(method, style: TextStyle(fontWeight: selected ? FontWeight.w600 : FontWeight.normal)),
                            value: method,
                            groupValue: _selectedPayment,
                            activeColor: Colors.indigo,
                            onChanged: (v) => setState(() => _selectedPayment = v!),
                          ),
                        );
                      }),

                      const SizedBox(height: 28),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: (_isRefunding || _activeTickets.isEmpty) ? null : _handleRefund,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.indigo,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: _isRefunding
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                                )
                              : const Text('Demander le remboursement', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
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
          backgroundColor: Colors.indigo,
          child: Text(num, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
        ),
        const SizedBox(width: 10),
        Text(text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
      ],
    );
  }
}