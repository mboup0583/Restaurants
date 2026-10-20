import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'screens/login_screen.dart';
import 'screens/dashboards/admin_dashboard.dart';
import 'screens/dashboards/agent_dashboard.dart';
import 'screens/dashboards/student_dashboard.dart';

void main() {
  runApp(const TicketRestoApp());
}

class TicketRestoApp extends StatelessWidget {
  const TicketRestoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthProvider()..loadUserFromStorage(),
      child: MaterialApp(
        title: 'Ticket Resto',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: Colors.deepOrange,
            brightness: Brightness.light,
          ),
          useMaterial3: true,
          appBarTheme: const AppBarTheme(
            centerTitle: true,
            elevation: 0,
          ),
          // ✅ Correction : CardThemeData au lieu de CardTheme
          cardTheme: CardThemeData(
            elevation: 1,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.grey.shade50,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
          ),
          elevatedButtonTheme: ElevatedButtonThemeData(
            style: ElevatedButton.styleFrom(
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              textStyle: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        home: const AuthWrapper(),
      ),
    );
  }
}

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);

    // Pendant le chargement initial
    if (authProvider.currentUser == null && !authProvider.isLoggedIn) {
      // On laisse un petit délai pour charger SharedPreferences
      return FutureBuilder(
        future: Future.delayed(const Duration(milliseconds: 300)),
        builder: (context, snapshot) {
          if (authProvider.currentUser != null) {
            return _getDashboard(authProvider);
          }
          return const LoginScreen();
        },
      );
    }

    if (authProvider.isLoggedIn && authProvider.currentUser != null) {
      return _getDashboard(authProvider);
    }

    return const LoginScreen();
  }

  Widget _getDashboard(AuthProvider authProvider) {
    final user = authProvider.currentUser!;
    if (user.isAdmin) return const AdminDashboard();
    if (user.isAgent) return const AgentDashboard();
    return const StudentDashboard();
  }
}