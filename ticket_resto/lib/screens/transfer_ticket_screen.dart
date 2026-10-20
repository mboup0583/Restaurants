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
  int? _selectedTicketId;
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

  Future<void> _handleTransfer() async {
    if (_selectedTicketId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sélectionnez un ticket'), backgroundColor: Colors.orange),
      );
      return;
    }

    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Email invalide'), backgroundColor: Colors.orange),
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
            const SnackBar(content: Text('Aucun utilisateur avec cet email'), backgroundColor: Colors.red),
          );
        }
        return;
      }

      final toUserId = recipient['id'] as int;
      final fromUserId = Provider.of<AuthProvider>(context, listen: false).currentUser!.id;

      if (toUserId == fromUserId) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Impossible de se transférer à soi-même'), backgroundColor: Colors.orange),
        );
        return;
      }

      final result = await ApiService.transferTicket(
        fromUserId: fromUserId,
        toUserId: toUserId,
        ticketId: _selectedTicketId!,
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
      if (mounted) setState(() => _isTransferring = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        title: const Text('Transférer un ticket'),
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
                        _emptyBox('Aucun ticket actif à transférer')
                      else
                        ..._activeTickets.map((ticket) {
                          final selected = _selectedTicketId == ticket['id'];
                          final isPdj = ticket['type'] == 'Petit-déjeuner';
                          return _ticketChoiceCard(
                            ticket: ticket,
                            selected: selected,
                            isPdj: isPdj,
                            onTap: () => setState(() => _selectedTicketId = ticket['id']),
                          );
                        }),

                      const SizedBox(height: 28),
                      _stepTitle('2', 'Email du destinataire'),
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
                            hintText: 'exemple@zig.univ.sn',
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
                          onPressed: (_isTransferring || _activeTickets.isEmpty) ? null : _handleTransfer,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.indigo,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          child: _isTransferring
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                                )
                              : const Text('Transférer le ticket', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
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
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.15),
          child: Icon(isPdj ? Icons.free_breakfast : Icons.restaurant, color: color),
        ),
        title: Text(ticket['type'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('${ticket['price']} FCFA'),
        trailing: selected ? Icon(Icons.check_circle, color: color) : null,
      ),
    );
  }
}