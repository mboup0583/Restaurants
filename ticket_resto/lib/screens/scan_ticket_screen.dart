import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class ScanTicketScreen extends StatefulWidget {
  const ScanTicketScreen({super.key});

  @override
  State<ScanTicketScreen> createState() => _ScanTicketScreenState();
}

class _ScanTicketScreenState extends State<ScanTicketScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _isProcessing = false;
  String? _lastScannedCode;
  bool _showManual = false;
  final TextEditingController _manualCodeController = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    _manualCodeController.dispose();
    super.dispose();
  }

  void _toggleManual() {
    setState(() {
      _showManual = !_showManual;
      _lastScannedCode = null;
      if (_showManual) {
        _controller.stop();
      } else {
        _controller.start();
      }
    });
  }

  Future<void> _handleScan(BarcodeCapture capture) async {
    if (_isProcessing) return;

    final code = capture.barcodes.first.rawValue;
    if (code == null || code == _lastScannedCode) return;

    setState(() {
      _isProcessing = true;
      _lastScannedCode = code;
    });

    try {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      final agentId = authProvider.currentUser!.id;

      final result = await ApiService.validateTicket(
        ticketCode: code,
        agentId: agentId,
      );

      if (!mounted) return;

      if (result['success'] == true) {
        _showResultDialog(true, result['message'] ?? 'Ticket validé');
      } else {
        _showResultDialog(false, result['message'] ?? 'Ticket invalide');
      }
    } catch (e) {
      if (mounted) {
        _showResultDialog(false, 'Erreur: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _isProcessing = false);
      }
    }
  }

  Future<void> _handleManualValidation() async {
    final code = _manualCodeController.text.trim();
    if (code.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Veuillez saisir un code'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    if (_isProcessing) return;

    setState(() => _isProcessing = true);

    try {
      final authProvider = Provider.of<AuthProvider>(context, listen: false);
      final agentId = authProvider.currentUser!.id;

      final result = await ApiService.validateTicket(
        ticketCode: code,
        agentId: agentId,
      );

      if (!mounted) return;

      if (result['success'] == true) {
        _showResultDialog(true, result['message'] ?? 'Ticket validé');
        _manualCodeController.clear();
      } else {
        _showResultDialog(false, result['message'] ?? 'Ticket invalide');
      }
    } catch (e) {
      if (mounted) {
        _showResultDialog(false, 'Erreur: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _isProcessing = false);
      }
    }
  }

  void _showResultDialog(bool success, String message) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Icon(
          success ? Icons.check_circle : Icons.error,
          color: success ? Colors.green : Colors.red,
          size: 48,
        ),
        content: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              setState(() {
                _lastScannedCode = null;
              });
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scanner un ticket'),
        backgroundColor: Colors.teal,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on),
            onPressed: () => _controller.toggleTorch(),
          ),
          IconButton(
            icon: const Icon(Icons.switch_camera),
            onPressed: () => _controller.switchCamera(),
          ),
        ],
      ),
      body: Stack(
        children: [
          // Scanner ou mode manuel
          if (!_showManual)
            MobileScanner(
              controller: _controller,
              onDetect: _handleScan,
            )
          else
            Container(
              color: Colors.black87,
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.keyboard,
                    size: 64,
                    color: Colors.white54,
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Saisie manuelle du code',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _manualCodeController,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      letterSpacing: 2,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Ex: PDJ_ABCD1234_XYZ',
                      hintStyle: const TextStyle(color: Colors.white54),
                      filled: true,
                      fillColor: Colors.white.withOpacity(0.1),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                      prefixIcon: const Icon(
                        Icons.confirmation_number,
                        color: Colors.white54,
                      ),
                    ),
                    textCapitalization: TextCapitalization.characters,
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isProcessing ? null : _handleManualValidation,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.teal,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _isProcessing
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2.5,
                              ),
                            )
                          : const Text(
                              'Valider le code',
                              style: TextStyle(fontSize: 16),
                            ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: _isProcessing ? null : _toggleManual,
                    icon: const Icon(Icons.qr_code_scanner),
                    label: const Text('Revenir au scan caméra'),
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),

          // Overlay pour le cadre de scan (uniquement en mode caméra)
          if (!_showManual)
            Center(
              child: Container(
                width: 250,
                height: 250,
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Colors.white,
                    width: 3,
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),

          // Indicateur de chargement
          if (_isProcessing)
            Container(
              color: Colors.black.withOpacity(0.5),
              child: const Center(
                child: CircularProgressIndicator(
                  color: Colors.white,
                ),
              ),
            ),

          // Instructions et bouton de saisie manuelle (uniquement en mode caméra)
          if (!_showManual) ...[
            const Positioned(
              bottom: 100,
              left: 0,
              right: 0,
              child: Text(
                'Placez le QR code dans le cadre',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  shadows: [Shadow(blurRadius: 8, color: Colors.black)],
                ),
              ),
            ),
            Positioned(
              bottom: 30,
              left: 24,
              right: 24,
              child: ElevatedButton.icon(
                onPressed: _isProcessing ? null : _toggleManual,
                icon: const Icon(Icons.keyboard),
                label: const Text('Saisie manuelle du code'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: Colors.teal,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}