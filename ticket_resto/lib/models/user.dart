class User {
  final int id;
  final String fullName;
  final String email;
  final String userType;
  final String? studentId;
  final bool isActive;

  User({
    required this.id,
    required this.fullName,
    required this.email,
    required this.userType,
    this.studentId,
    this.isActive = true,
  });

  // Créer un User à partir du JSON renvoyé par le serveur
  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as int,
      fullName: json['full_name'] as String,
      email: json['email'] as String,
      userType: json['user_type'] as String,
      studentId: json['student_id'] as String?,
      isActive: json['is_active'] == 1 || json['is_active'] == true,
    );
  }

  // Convertir en Map (utile pour SharedPreferences)
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'full_name': fullName,
      'email': email,
      'user_type': userType,
      'student_id': studentId,
      'is_active': isActive,
    };
  }

  // Helpers pratiques
  bool get isAdmin => userType == 'Administrateur';
  bool get isAgent => userType == 'Agent universitaire';
  bool get isStudent => userType == 'Étudiant';
}