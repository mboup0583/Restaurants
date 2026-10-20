class AppConstants {
  // Adresse du serveur
  // Pour l'émulateur Android → 10.0.2.2
  // Pour un téléphone physique → IP de ton PC (ex: 192.168.1.67)
  //static const String baseUrl = 'http://10.0.2.2:3001';

  static const String baseUrl = 'http://192.168.1.6:3001';

  // Endpoints
  static const String loginEndpoint = '/api/mobile/login';
  static const String registerEndpoint = '/api/mobile/register';
  static const String usersEndpoint = '/api/mobile/users';
  static const String buyTicketsEndpoint = '/api/mobile/tickets/buy';
  static const String myTicketsEndpoint = '/api/mobile/tickets/my';
  static const String validateTicketEndpoint = '/api/mobile/tickets/validate';
  static const String transferTicketEndpoint = '/api/mobile/tickets/transfer';
  static const String refundTicketEndpoint = '/api/mobile/tickets/refund';

  // Clés SharedPreferences
  static const String keyUserId = 'user_id';
  static const String keyUserEmail = 'user_email';
  static const String keyUserFullName = 'user_full_name';
  static const String keyUserType = 'user_type';
  static const String keyStudentId = 'student_id';
  static const String keyIsLoggedIn = 'is_logged_in';
  static const String keyToken = 'auth_token'; // ✅ Ajouté
}