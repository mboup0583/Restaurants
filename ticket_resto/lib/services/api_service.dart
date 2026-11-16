import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants.dart';
import '../models/user.dart';

class ApiService {
  // ==================== HEADERS HELPER ====================
  static Future<String?> _getSavedToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(AppConstants.keyToken);
  }

  static Future<Map<String, String>> _headers({bool withAuth = true, String? token}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };

    if (withAuth) {
      final t = token ?? await _getSavedToken();
      if (t != null && t.isNotEmpty) {
        headers['Authorization'] = 'Bearer $t';
      }
    }
    return headers;
  }

  // ==================== LOGIN ====================
  static Future<Map<String, dynamic>> login(String email, String password) async {
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.loginEndpoint}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': email,
          'password': password,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'user': User.fromJson(data['user']),
          'token': data['token'],
          'message': data['message'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur de connexion',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur. Vérifie ta connexion.',
      };
    }
  }

  // ==================== REGISTER ====================
  static Future<Map<String, dynamic>> register({
    required String fullName,
    required String email,
    required String password,
    required String userType,
    String? studentId,
    String? phone,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.registerEndpoint}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'full_name': fullName,
          'email': email,
          'password': password,
          'user_type': userType,
          'student_id': studentId,
          'phone': phone,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 201 && data['success'] == true) {
        return {
          'success': true,
          'user': User.fromJson(data['user']),
          'token': data['token'],
          'message': data['message'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur d\'inscription',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== MES TICKETS ====================
  static Future<Map<String, dynamic>> getMyTickets(int userId, {String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.get(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.myTicketsEndpoint}/$userId'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'tickets': data['tickets'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors du chargement des tickets',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== ACHETER DES TICKETS ====================
  static Future<Map<String, dynamic>> buyTickets({
    required int userId,
    required String type,
    required int quantity,
    required String paymentMethod,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.buyTicketsEndpoint}'),
        headers: headers,
        body: jsonEncode({
          'user_id': userId,
          'type': type,
          'quantity': quantity,
          'payment_method': paymentMethod,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 201 && data['success'] == true) {
        return {
          'success': true,
          'tickets': data['tickets'],
          'message': data['message'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors de l\'achat',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== TRANSFÉRER UN OU PLUSIEURS TICKETS ====================
  static Future<Map<String, dynamic>> transferTickets({
    required int fromUserId,
    required int toUserId,
    required List<int> ticketIds,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.transferTicketEndpoint}'),
        headers: headers,
        body: jsonEncode({
          'from_user_id': fromUserId,
          'to_user_id': toUserId,
          'ticket_ids': ticketIds,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Tickets transférés avec succès',
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors du transfert',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  static Future<Map<String, dynamic>> transferTicket({
    required int fromUserId,
    required int toUserId,
    required int ticketId,
    String? token,
  }) async {
    return transferTickets(
      fromUserId: fromUserId,
      toUserId: toUserId,
      ticketIds: [ticketId],
      token: token,
    );
  }

  // ==================== LISTE DES UTILISATEURS ====================
  static Future<Map<String, dynamic>> getUsers({String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.get(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.usersEndpoint}'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'users': data['users'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== MODIFIER MOT DE PASSE (ADMIN) ====================
  static Future<Map<String, dynamic>> updateUserPassword({
    required int userId,
    required String newPassword,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.patch(
        Uri.parse('${AppConstants.baseUrl}/api/admin/users/$userId'),
        headers: headers,
        body: jsonEncode({'password': newPassword}),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Mot de passe modifié',
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors de la modification',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== SUPPRIMER UTILISATEUR (ADMIN) ====================
  static Future<Map<String, dynamic>> deleteUser(int userId, {String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.delete(
        Uri.parse('${AppConstants.baseUrl}/api/admin/users/$userId'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Utilisateur supprimé',
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors de la suppression',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== DEMANDER UN REMBOURSEMENT ====================
  static Future<Map<String, dynamic>> refundTicket({
    required int userId,
    required int ticketId,
    required String paymentMethod,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.refundTicketEndpoint}'),
        headers: headers,
        body: jsonEncode({
          'user_id': userId,
          'ticket_id': ticketId,
          'payment_method': paymentMethod,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Demande de remboursement enregistrée',
          'refund_id': data['refund_id'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors du remboursement',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== VALIDER UN TICKET (SCAN) ====================
  static Future<Map<String, dynamic>> validateTicket({
    required String ticketCode,
    required int agentId,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}${AppConstants.validateTicketEndpoint}'),
        headers: headers,
        body: jsonEncode({
          'ticket_code': ticketCode,
          'agent_id': agentId,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'] ?? 'Ticket validé',
          'ticket': data['ticket'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur de validation',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== TOUS LES TICKETS (ADMIN) ====================
  static Future<Map<String, dynamic>> getAllTickets({String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.get(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/tickets'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'tickets': data['tickets'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== STATISTIQUES (ADMIN) ====================
  static Future<Map<String, dynamic>> getStats({String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.get(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/stats'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'stats': data['stats'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== ENVOYER CODE VÉRIFICATION ====================
  static Future<Map<String, dynamic>> sendVerificationCode({
    required String fullName,
    required String email,
    required String password,
    required String userType,
    String? studentId,
    String? phone,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/send-verification-code'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'full_name': fullName,
          'email': email,
          'password': password,
          'user_type': userType,
          'student_id': studentId,
          'phone': phone,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'message': data['message'],
          'debug_code': data['debug_code'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur d\'envoi du code',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== VÉRIFIER CODE + CRÉER COMPTE ====================
  static Future<Map<String, dynamic>> verifyAndRegister({
    required String email,
    required String code,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/verify-and-register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': email,
          'code': code,
        }),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 201 && data['success'] == true) {
        return {
          'success': true,
          'user': User.fromJson(data['user']),
          'token': data['token'],
          'message': data['message'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Code incorrect',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== OBTENIR LES PRIX (MOBILE) ====================
  static Future<Map<String, dynamic>> getPrices({String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.get(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/prices'),
        headers: headers,
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'prices': data['prices'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors du chargement des prix',
          'prices': {'petit_dejeuner': 50, 'repas': 100},
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
        'prices': {'petit_dejeuner': 50, 'repas': 100},
      };
    }
  }

  // ==================== RAPPORT VENTES (AGENT) ====================
  static Future<Map<String, dynamic>> getSalesReport({String? token}) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.get(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/sales-report'),
        headers: headers,
      );
      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'report': data['report'],
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== INITIER PAIEMENT PAYDUNYA (WAVE) ====================
  static Future<Map<String, dynamic>> initPayment({
    required int userId,
    required String type,
    required int quantity,
    required String paymentMethod,
    String? phone,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final body = <String, dynamic>{
        'user_id': userId,
        'type': type,
        'quantity': quantity,
        'payment_method': paymentMethod,
      };
      if (phone != null && phone.trim().isNotEmpty) {
        body['phone'] = phone.trim();
      }

      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/payments/init'),
        headers: headers,
        body: jsonEncode(body),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['success'] == true) {
        return {
          'success': true,
          'payment_id': data['payment_id'],
          'payment_url': data['payment_url'],
          'token': data['token'],
          'amount': data['amount'],
          'message': data['message'] ?? 'Paiement initialisé',
        };
      } else {
        return {
          'success': false,
          'message': data['message'] ?? 'Erreur lors de l\'initialisation du paiement',
        };
      }
    } catch (e) {
      return {
        'success': false,
        'message': 'Impossible de contacter le serveur.',
      };
    }
  }

  // ==================== VÉRIFIER PAIEMENT (APRÈS RETOUR WAVE) ====================
  static Future<Map<String, dynamic>> verifyPayment({
    required int paymentId,
    String? token,
  }) async {
    try {
      final headers = await _headers(withAuth: true, token: token);
      final response = await http.post(
        Uri.parse('${AppConstants.baseUrl}/api/mobile/payments/verify'),
        headers: headers,
        body: jsonEncode({'payment_id': paymentId}),
      );

      final data = jsonDecode(response.body);
      return {
        'success': data['success'] == true,
        'pending': data['pending'] == true,
        'message': data['message'],
        'tickets_created': data['tickets_created'] == true,
        'tickets': data['tickets'],
      };
    } catch (e) {
      return {'success': false, 'pending': true, 'message': e.toString()};
    }
  }
}