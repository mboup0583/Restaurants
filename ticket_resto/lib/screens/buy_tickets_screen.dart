import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class BuyTicketsScreen extends StatefulWidget {
  const BuyTicketsScreen({super.key});

  @override
  State<BuyTicketsScreen> createState() => _BuyTicketsScreenState();
}

class _BuyTicketsScreenState extends State<BuyTicketsScreen> {
  String _selectedType = 'Repas';
  int _quantity = 1;
  String _selectedPayment = 'Wave';
  bool _isLoading = false;
  
  // Prix dynamiques
  int _petitDejeunerPrice = 50;
  int _repasPrice = 100;
  bool _isLoadingPrices = true;

  // ✅ AJOUTER CETTE LIGNE
  final List<String> _paymentMethods = [
    'Wave',
    'Orange Money',
  ];

  @override
  void initState() {
    super.initState();
    _loadPrices();
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

  Future<void> _handleBuy() async {
    if (_isLoading) return;

    setState(() => _isLoading = true);

    try {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      final userId = authProvider.currentUser!.id;

      final result = await ApiService.buyTickets(
        userId: userId,
        type: _selectedType,
        quantity: _quantity,
        paymentMethod: _selectedPayment,
      );

      if (!mounted) return;

      if (result['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Achat réussi'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).pop();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result['message'] ?? 'Erreur lors de l\'achat'),
            backgroundColor: Colors.red,
          ),
        );
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
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Utiliser les prix dynamiques
    final price = _selectedType == 'Petit-déjeuner' ? _petitDejeunerPrice : _repasPrice;
    final total = price * _quantity;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Acheter des tickets'),
        backgroundColor: Colors.indigo,
        foregroundColor: Colors.white,
      ),
      body: _isLoadingPrices
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Type de ticket',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
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
                          onTap: () => setState(() => _selectedType = 'Petit-déjeuner'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _typeCard(
                          title: 'Repas',
                          price: '$_repasPrice FCFA',
                          icon: Icons.restaurant,
                          isSelected: _selectedType == 'Repas',
                          onTap: () => setState(() => _selectedType = 'Repas'),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 30),
                  const Text(
                    'Quantité',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
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
                        color: Colors.indigo,
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
                        color: Colors.indigo,
                      ),
                    ],
                  ),

                  const SizedBox(height: 30),
                  const Text(
                    'Moyen de paiement',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),

                  ..._paymentMethods.map((method) {
                    return RadioListTile<String>(
                      title: Text(method),
                      value: method,
                      groupValue: _selectedPayment,
                      activeColor: Colors.indigo,
                      onChanged: (value) {
                        setState(() => _selectedPayment = value!);
                      },
                    );
                  }),

                  const SizedBox(height: 20),

                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.indigo.shade50,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Total à payer',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
                        ),
                        Text(
                          '$total FCFA',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Colors.indigo,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 30),

                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _handleBuy,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.indigo,
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

                  const SizedBox(height: 40),
                ],
              ),
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
          color: isSelected ? Colors.indigo.shade50 : Colors.grey.shade100,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? Colors.indigo : Colors.transparent,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              size: 36,
              color: isSelected ? Colors.indigo : Colors.grey,
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: isSelected ? Colors.indigo : Colors.black87,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              price,
              style: TextStyle(
                color: isSelected ? Colors.indigo : Colors.grey,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}