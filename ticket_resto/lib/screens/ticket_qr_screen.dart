import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

class TicketQrScreen extends StatelessWidget {
  final Map<String, dynamic> ticket;

  const TicketQrScreen({super.key, required this.ticket});

  @override
  Widget build(BuildContext context) {
    final ticketCode = ticket['ticket_code']?.toString() ?? '';
    final type = ticket['type']?.toString() ?? '';
    final price = ticket['price']?.toString() ?? '';
    final status = ticket['status']?.toString() ?? '';

    final isActive = status == 'ACTIVE';

    return Scaffold(
      appBar: AppBar(
        title: const Text('QR Code du ticket'),
        backgroundColor: Colors.indigo,
        foregroundColor: Colors.white,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                type,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '$price FCFA',
                style: const TextStyle(fontSize: 16, color: Colors.grey),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: isActive
                      ? Colors.green.withOpacity(0.15)
                      : Colors.grey.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  isActive ? 'Actif' : status,
                  style: TextStyle(
                    color: isActive ? Colors.green : Colors.grey,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 30),

              // QR Code
              if (isActive)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.1),
                        blurRadius: 10,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: QrImageView(
                    data: ticketCode,
                    version: QrVersions.auto,
                    size: 250,
                    backgroundColor: Colors.white,
                  ),
                )
              else
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Text(
                    'Ce ticket n\'est plus actif.\nLe QR code n\'est pas disponible.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey, fontSize: 16),
                  ),
                ),

              const SizedBox(height: 24),
              Text(
                ticketCode,
                style: const TextStyle(
                  fontSize: 13,
                  fontFamily: 'monospace',
                  color: Colors.black54,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              const Text(
                'Présentez ce QR code à l\'agent du restaurant',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
            ],
          ),
        ),
      ),
    );
  }
}