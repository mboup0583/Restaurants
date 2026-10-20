import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants.dart';
import '../models/user.dart';
import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
  User? _currentUser;
  bool _isLoading = false;
  String? _errorMessage;
  String? _token;

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get isLoggedIn => _currentUser != null;
  String? get token => _token;

  // ==================== CHARGER L'UTILISATEUR SAUVEGARDÉ ====================
  Future<void> loadUserFromStorage() async {
    print('📂 [loadUserFromStorage] Chargement depuis SharedPreferences...');
    final prefs = await SharedPreferences.getInstance();
    final isLoggedIn = prefs.getBool(AppConstants.keyIsLoggedIn) ?? false;
    print('📂 [loadUserFromStorage] isLoggedIn: $isLoggedIn');

    if (isLoggedIn) {
      final id = prefs.getInt(AppConstants.keyUserId);
      final email = prefs.getString(AppConstants.keyUserEmail);
      final fullName = prefs.getString(AppConstants.keyUserFullName);
      final userType = prefs.getString(AppConstants.keyUserType);
      final studentId = prefs.getString(AppConstants.keyStudentId);
      final token = prefs.getString(AppConstants.keyToken);

      print('📂 [loadUserFromStorage] Token chargé: ${token != null ? "✅ OUI" : "❌ NON"}');

      if (id != null && email != null && fullName != null && userType != null) {
        _token = token;
        _currentUser = User(
          id: id,
          fullName: fullName,
          email: email,
          userType: userType,
          studentId: studentId,
        );
        print('👤 [loadUserFromStorage] Utilisateur chargé: ${fullName}');
        notifyListeners();
      } else {
        print('⚠️ [loadUserFromStorage] Données utilisateur incomplètes');
      }
    } else {
      print('📂 [loadUserFromStorage] Aucun utilisateur connecté');
    }
  }

  // ==================== SAUVEGARDER L'UTILISATEUR ====================
  Future<void> _saveUserToStorage(User user, {String? token}) async {
    print('💾 [_saveUserToStorage] Sauvegarde utilisateur...');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(AppConstants.keyIsLoggedIn, true);
    await prefs.setInt(AppConstants.keyUserId, user.id);
    await prefs.setString(AppConstants.keyUserEmail, user.email);
    await prefs.setString(AppConstants.keyUserFullName, user.fullName);
    await prefs.setString(AppConstants.keyUserType, user.userType);
    if (user.studentId != null) {
      await prefs.setString(AppConstants.keyStudentId, user.studentId!);
    }
    if (token != null) {
      await prefs.setString(AppConstants.keyToken, token);
      _token = token;
      print('💾 [_saveUserToStorage] Token sauvegardé: ✅');
    } else {
      print('⚠️ [_saveUserToStorage] Aucun token à sauvegarder');
    }
  }

  // ==================== LOGIN ====================
  Future<bool> login(String email, String password) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    print('📡 [login] Tentative de connexion...');
    print('📧 [login] Email: $email');
    
    final result = await ApiService.login(email, password);

    _isLoading = false;

    print('📡 [login] Résultat - success: ${result['success']}');
    print('📡 [login] Token présent: ${result['token'] != null}');
    
    if (result['token'] != null) {
      print('🔑 [login] Token: ${result['token']}');
    }

    if (result['success'] == true) {
      _currentUser = result['user'] as User;
      final token = result['token'] as String?;
      
      print('💾 [login] Sauvegarde du token...');
      await _saveUserToStorage(_currentUser!, token: token);
      
      // Vérifier que le token est bien sauvegardé
      final prefs = await SharedPreferences.getInstance();
      final savedToken = prefs.getString(AppConstants.keyToken);
      print('🔑 [login] Token sauvegardé: ${savedToken != null ? "✅ OUI" : "❌ NON"}');
      if (savedToken != null) {
        print('🔑 [login] Token sauvegardé: ${savedToken.substring(0, 20)}...');
      }
      
      notifyListeners();
      print('✅ [login] Connexion réussie pour ${_currentUser?.fullName}');
      return true;
    } else {
      _errorMessage = result['message'];
      print('❌ [login] Erreur: $_errorMessage');
      notifyListeners();
      return false;
    }
  }

  // ==================== REGISTER ====================
  Future<bool> register({
    required String fullName,
    required String email,
    required String password,
    required String userType,
    String? studentId,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    print('📝 [register] Tentative d\'inscription...');
    print('👤 [register] Nom: $fullName');
    print('📧 [register] Email: $email');

    final result = await ApiService.register(
      fullName: fullName,
      email: email,
      password: password,
      userType: userType,
      studentId: studentId,
    );

    _isLoading = false;

    print('📡 [register] Résultat - success: ${result['success']}');
    print('📡 [register] Token présent: ${result['token'] != null}');

    if (result['success'] == true) {
      _currentUser = result['user'] as User;
      final token = result['token'] as String?;
      
      print('💾 [register] Sauvegarde du token...');
      await _saveUserToStorage(_currentUser!, token: token);
      
      // Vérifier que le token est bien sauvegardé
      final prefs = await SharedPreferences.getInstance();
      final savedToken = prefs.getString(AppConstants.keyToken);
      print('🔑 [register] Token sauvegardé: ${savedToken != null ? "✅ OUI" : "❌ NON"}');
      
      notifyListeners();
      print('✅ [register] Inscription réussie pour $_currentUser?.fullName');
      return true;
    } else {
      _errorMessage = result['message'];
      print('❌ [register] Erreur: $_errorMessage');
      notifyListeners();
      return false;
    }
  }

  // ==================== LOGOUT ====================
  Future<void> logout() async {
    print('🚪 [logout] Déconnexion...');
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    _currentUser = null;
    _token = null;
    _errorMessage = null;
    notifyListeners();
    print('✅ [logout] Déconnecté avec succès');
  }

  // Effacer le message d'erreur
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
}