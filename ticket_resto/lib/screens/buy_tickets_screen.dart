import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class BuyTicketsScreen extends StatefulWidget {
  const BuyTicketsScreen({super.key});

  @override
  State<BuyTicketsScreen> createState() => _BuyTicketsScreenState();
}

class _BuyTicketsScreenState extends State<BuyTicketsScreen>
    with WidgetsBindingObserver {
  String _selectedType = 'Repas';
  int _quantity = 1;
  String _selectedPayment = 'Wave';
  bool _isLoading = false;
  bool _waitingPayment = false;
  int? _pendingPaymentId;

  int _petitDejeunerPrice = 50;
  int _repasPrice = 100;
  bool _isLoadingPrices = true;

  final List<String> _paymentMethods = ['Wave', 'Orange Money'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadPrices();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Quand l'utilisateur revient de Wave → on vérifie automatiquement
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _waitingPayment &&
        _pendingPaymentId != null) {
      _pollVerify(maxTries: 12, delaySeconds: 3);
    }
  }

  Future<void> _loadPrices() async {
    final result = await ApiService.getPrices();
    if (mounted) {
      setState(() {
        if (result['success'] == true) {
          final prices = result['prices'];
          _petitDejeunerPrice = prices['petit_dejeuner'] ?? 50;
          _repasPrice = prices['repas'] ?? 100;
        }
        _isLoadingPrices = false;
      });
    }
  }

  Future<void> _savePendingPayment(int paymentId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('pending_payment_id', paymentId);
  }

  Future<void> _clearPendingPayment() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('pending_payment_id');
  }

  Future<void> _pollVerify({
    required int maxTries,
    required int delaySeconds,
  }) async {
    final paymentId = _pendingPaymentId;
    if (paymentId == null) return;

    if (mounted) setState(() => _isLoading = true);

    for (var i = 0; i < maxTries; i++) {
      if (!mounted) return;

      final v = await ApiService.verifyPayment(paymentId: paymentId);

      if (v['success'] == true && v['tickets_created'] == true) {
        await _clearPendingPayment();
        if (!mounted) return;
        setState(() {
          _isLoading = false;
          _waitingPayment = false;
          _pendingPaymentId = null;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Paiement confirmé. Tickets disponibles.'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop(true);
        return;
      }

      await Future.delayed(Duration(seconds: delaySeconds));
    }

    if (!mounted) return;
    setState(() => _isLoading = false);
    // On garde _waitingPayment = true : un nouveau retour dans l'app relancera
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Paiement en cours chez Wave… Reviens dans l’app après confirmation.',
        ),
      ),
    );
  }

  Future<String?> _showPhonePromptDialog(BuildContext context) async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.phone_android, color: Color(0xFF1B5E20)),
            SizedBox(width: 8),
            Text('Numéro Wave requis', style: TextStyle(fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Veuillez saisir votre numéro Wave pour le paiement :',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              keyboardType: TextInputType.phone,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Numéro Wave (ex: 77 123 45 67)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Annuler'),
          ),
          ElevatedButton(
            onPressed: () {
              final text = controller.text.trim();
              if (text.isNotEmpty) Navigator.pop(ctx, text);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF1B5E20),
              foregroundColor: Colors.white,
            ),
            child: const Text('Confirmer'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleBuy() async {
    if (_isLoading) return;

    if (_selectedPayment == 'Orange Money') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Orange Money bientôt disponible. Utilisez Wave.'),
          backgroundColor: const Color(0xFF2E7D32),
        ),
      );
      return;
    }

    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final user = authProvider.currentUser;

    if (user == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Session expirée. Reconnecte-toi.')),
      );
      return;
    }

    String? phone = user.phone;
    if (phone == null || phone.trim().isEmpty) {
      phone = await _showPhonePromptDialog(context);
      if (phone == null || phone.trim().isEmpty) return;
    }


    setState(() => _isLoading = true);

    try {
      final result = await ApiService.initPayment(
        userId: user.id,
        type: _selectedType,
        quantity: _quantity,
        paymentMethod: 'Wave',
        phone: phone,
      );

      if (!mounted) return;

      if (result['success'] != true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Erreur lors de l\'achat'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      final paymentUrl = result['payment_url'] as String?;
      final paymentId = result['payment_id'];

      if (paymentId == null || paymentUrl == null || paymentUrl.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Réponse paiement invalide'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      final id = paymentId is int
          ? paymentId
          : int.tryParse(paymentId.toString());

      if (id == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('payment_id invalide'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      _pendingPaymentId = id;
      _waitingPayment = true;
      await _savePendingPayment(id);

      final uri = Uri.parse(paymentUrl);
      bool launched = false;
      try {
        if (await canLaunchUrl(uri)) {
          launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      } catch (_) {}

      if (!launched) {
        try {
          launched = await launchUrl(uri, mode: LaunchMode.platformDefault);
        } catch (_) {}
      }

      if (!launched) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Impossible d\'ouvrir la page de paiement Wave'),
            backgroundColor: Colors.red,
          ),
        );
        return;
      }

      // Première vague de vérif (pendant / juste après Wave)
      // Le vrai filet = didChangeAppLifecycleState au retour
      if (mounted) {
        await _pollVerify(maxTries: 8, delaySeconds: 5);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erreur : $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted && !_waitingPayment) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final price =
        _selectedType == 'Petit-déjeuner' ? _petitDejeunerPrice : _repasPrice;
    final total = price * _quantity;
    final userPhone = Provider.of<AuthProvider>(context).currentUser?.phone;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Acheter des tickets'),
        backgroundColor: const Color(0xFF1B5E20),
        foregroundColor: Colors.white,
      ),
      body: _isLoadingPrices
          ? const Center(child: CircularProgressIndicator())
          : Stack(
              children: [
                SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Type de ticket',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: _typeCard(
                              title: 'Petit-déjeuner',
                              price: '$_petitDejeunerPrice FCFA',
                              icon: Icons.free_breakfast,
                              isSelected: _selectedType == 'Petit-déjeuner',
                              onTap: () => setState(
                                  () => _selectedType = 'Petit-déjeuner'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _typeCard(
                              title: 'Repas',
                              price: '$_repasPrice FCFA',
                              icon: Icons.restaurant,
                              isSelected: _selectedType == 'Repas',
                              onTap: () =>
                                  setState(() => _selectedType = 'Repas'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 30),
                      const Text(
                        'Quantité',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          IconButton(
                            onPressed: _quantity > 1
                                ? () => setState(() => _quantity--)
                                : null,
                            icon: const Icon(Icons.remove_circle_outline),
                            iconSize: 36,
                            color: const Color(0xFF1B5E20),
                          ),
                          Container(
                            width: 60,
                            alignment: Alignment.center,
                            child: Text(
                              '$_quantity',
                              style: const TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: _quantity < 10
                                ? () => setState(() => _quantity++)
                                : null,
                            icon: const Icon(Icons.add_circle_outline),
                            iconSize: 36,
                            color: const Color(0xFF1B5E20),
                          ),
                        ],
                      ),
                      const SizedBox(height: 30),
                      const Text(
                        'Moyen de paiement',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 12),
                      ..._paymentMethods.map((method) {
                        return RadioListTile<String>(
                          title: Text(method),
                          value: method,
                          groupValue: _selectedPayment,
                          activeColor: const Color(0xFF1B5E20),
                          onChanged: (value) {
                            setState(() => _selectedPayment = value!);
                          },
                        );
                      }),
                      if (_selectedPayment == 'Wave' &&
                          userPhone != null &&
                          userPhone.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          'Paiement Wave sur le numéro : $userPhone',
                          style: TextStyle(
                              color: Colors.grey.shade700, fontSize: 13),
                        ),
                      ],
                      const SizedBox(height: 20),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.green.shade50,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Total à payer',
                              style: TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w500),
                            ),
                            Text(
                              '$total FCFA',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF1B5E20),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Paiement instantané et sécurisé via Wave',
                        style: TextStyle(fontSize: 12, color: Colors.grey),
                      ),
                      const SizedBox(height: 30),
                      SizedBox(
                        width: double.infinity,
                        height: 50,
                        child: ElevatedButton(
                          onPressed: _isLoading ? null : _handleBuy,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF1B5E20),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: _isLoading
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(
                                    color: Colors.white,
                                    strokeWidth: 2.5,
                                  ),
                                )
                              : const Text(
                                  'Confirmer l\'achat',
                                  style: TextStyle(fontSize: 16),
                                ),
                        ),
                      ),
                      if (_waitingPayment) ...[
                        const SizedBox(height: 16),
                        const Text(
                          'En attente de confirmation Wave…\nAprès paiement, reviens simplement dans Ticket Resto.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: const Color(0xFF1B5E20)),
                        ),
                      ],
                      const SizedBox(height: 40),
                    ],
                  ),
                ),
                if (_isLoading && _waitingPayment)
                  Container(
                    color: Colors.black26,
                    child: const Center(
                      child: Card(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              CircularProgressIndicator(),
                              SizedBox(height: 16),
                              Text('Confirmation du paiement…'),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _typeCard({
    required String title,
    required String price,
    required IconData icon,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected ? Colors.green.shade50 : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? const Color(0xFF1B5E20) : Colors.transparent,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              size: 36,
              color: isSelected ? const Color(0xFF1B5E20) : Colors.grey,
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: isSelected ? const Color(0xFF1B5E20) : Colors.black87,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              price,
              style: TextStyle(
                color: isSelected ? const Color(0xFF1B5E20) : Colors.grey,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}