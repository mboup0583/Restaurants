import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../login_screen.dart';
import '../my_tickets_screen.dart';
import '../buy_tickets_screen.dart';
import '../transfer_ticket_screen.dart';
import '../refund_ticket_screen.dart';

class StudentDashboard extends StatelessWidget {
  const StudentDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final user = authProvider.currentUser;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        title: const Text('Tableau de bord Étudiant'),
        backgroundColor: Colors.indigo,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await authProvider.logout();
              if (context.mounted) {
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                );
              }
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Bonjour,',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
            ),
            Text(
              user?.fullName ?? '',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Text(
              'Rôle : ${user?.userType ?? ''}',
              style: TextStyle(color: Colors.grey.shade600),
            ),
            const SizedBox(height: 30),
            _buildMenuCard(
              context,
              Icons.shopping_cart,
              'Acheter des tickets',
              const BuyTicketsScreen(),
              color: Colors.indigo,
            ),
            _buildMenuCard(
              context,
              Icons.confirmation_number,
              'Mes tickets',
              const MyTicketsScreen(),
              color: Colors.indigo,
            ),
            _buildMenuCard(
              context,
              Icons.swap_horiz,
              'Transférer un ticket',
              const TransferTicketScreen(),
              color: Colors.indigo,
            ),
            _buildMenuCard(
              context,
              Icons.money_off,
              'Demander un remboursement',
              const RefundTicketScreen(),
              color: Colors.indigo,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMenuCard(
    BuildContext context,
    IconData icon,
    String title,
    Widget? screen, {
    Color color = Colors.indigo,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: color.withOpacity(0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: color, size: 24),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 15,
          ),
        ),
        trailing: Icon(
          Icons.arrow_forward_ios,
          size: 14,
          color: Colors.grey.shade400,
        ),
        onTap: screen == null
            ? () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Bientôt disponible')),
                );
              }
            : () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => screen),
                );
              },
      ),
    );
  }
}