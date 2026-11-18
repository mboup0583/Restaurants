import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class TransferTicketScreen extends StatefulWidget {
  const TransferTicketScreen({super.key});

  @override
  State<TransferTicketScreen> createState() => _TransferTicketScreenState();
}

class _TransferTicketScreenState extends State<TransferTicketScreen> {
  List<dynamic> _activeTickets = [];
  bool _isLoading = true;
  bool _isTransferring = false;
  String? _error;
  final Set<int> _selectedTicketIds = {};
  final _emailController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadActiveTickets();
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
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

  Future<void> _handleTransfer() async {
    if (_selectedTicketIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Sélectionnez au moins un ticket à transférer'),
          backgroundColor: const Color(0xFF2E7D32),
        ),
      );
      return;
    }

    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Veuillez saisir un email valide pour le destinataire'),
          backgroundColor: const Color(0xFF2E7D32),
        ),
      );
      return;
    }

    setState(() => _isTransferring = true);

    try {
      final usersResult = await ApiService.getUsers();
      if (usersResult['success'] != true) {
        throw Exception(usersResult['message'] ?? 'Impossible de trouver l\'utilisateur');
      }

      final users = usersResult['users'] as List;
      final recipient = users.cast<dynamic>().firstWhere(
            (u) => u['email'] == email,
            orElse: () => null,
          );

      if (recipient == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Aucun utilisateur avec cet email'),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }

      final toUserId = recipient['id'] as int;
      final fromUserId = Provider.of<AuthProvider>(context, listen: false).currentUser!.id;

      if (toUserId == fromUserId) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Impossible de se transférer des tickets à soi-même'),
            backgroundColor: const Color(0xFF2E7D32),
          ),
        );
        return;
      }

      final result = await ApiService.transferTickets(
        fromUserId: fromUserId,
        toUserId: toUserId,
        ticketIds: _selectedTicketIds.toList(),
      );

      if (!mounted) return;

      if (result['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Tickets transférés avec succès'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop(true);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Erreur lors du transfert'),
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
      if (mounted) setState(() => _isTransferring = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final allSelected = _activeTickets.isNotEmpty && _selectedTicketIds.length == _activeTickets.length;
    final totalSelected = _calculateTotalSelected();

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F7),
      appBar: AppBar(
        title: const Text('Transférer des tickets'),
        backgroundColor: const Color(0xFF1B5E20),
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
                                color: const Color(0xFF1B5E20),
                              ),
                              label: Text(
                                allSelected ? 'Tout désélectionner' : 'Tout cocher',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: const Color(0xFF1B5E20),
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
                            color: const Color(0xFF1B5E20).withOpacity(0.08),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFF1B5E20).withOpacity(0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.confirmation_number_outlined, size: 20, color: const Color(0xFF1B5E20)),
                              const SizedBox(width: 10),
                              Text(
                                '${_selectedTicketIds.length} ticket(s) sélectionné(s) • Total: ${totalSelected.toStringAsFixed(0)} FCFA',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: const Color(0xFF1B5E20),
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),

                      if (_activeTickets.isEmpty)
                        _emptyBox('Aucun ticket actif à transférer')
                      else
                        ..._activeTickets.map((ticket) {
                          final ticketId = ticket['id'] as int;
                          final selected = _selectedTicketIds.contains(ticketId);
                          final isPdj = ticket['type'] == 'Petit-déjeuner';
                          return _ticketChoiceCard(
                            ticket: ticket,
                            selected: selected,
                            isPdj: isPdj,
                            onTap: () => _toggleTicket(ticketId),
                          );
                        }),

                      const SizedBox(height: 28),
                      _stepTitle('2', 'Email de l\'ami(e) destinataire'),
                      const SizedBox(height: 12),
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.04),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: TextField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: InputDecoration(
                            labelText: 'Email du destinataire',
                            hintText: 'ami@zig.univ.sn',
                            prefixIcon: const Icon(Icons.email_outlined),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide.none,
                            ),
                            filled: true,
                            fillColor: Colors.white,
                          ),
                        ),
                      ),

                      const SizedBox(height: 28),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: (_isTransferring || _selectedTicketIds.isEmpty) ? null : _handleTransfer,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF1B5E20),
                            foregroundColor: Colors.white,
                            disabledBackgroundColor: Colors.grey.shade300,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: _isTransferring
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                                )
                              : Text(
                                  _selectedTicketIds.isEmpty
                                      ? 'Sélectionnez un ou plusieurs tickets'
                                      : _selectedTicketIds.length == 1
                                          ? 'Transférer 1 ticket'
                                          : 'Transférer les ${_selectedTicketIds.length} tickets (${totalSelected.toStringAsFixed(0)} FCFA)',
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
          backgroundColor: const Color(0xFF1B5E20),
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

  Widget _ticketChoiceCard({
    required dynamic ticket,
    required bool selected,
    required bool isPdj,
    required VoidCallback onTap,
  }) {
    final color = isPdj ? const Color(0xFF2E7D32) : const Color(0xFF1B5E20);
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
        onTap: onTap,
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
  }
}
