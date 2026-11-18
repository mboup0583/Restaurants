import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ManageUsersScreen extends StatefulWidget {
  const ManageUsersScreen({super.key});

  @override
  State<ManageUsersScreen> createState() => _ManageUsersScreenState();
}

class _ManageUsersScreenState extends State<ManageUsersScreen> {
  List<dynamic> _users = [];
  bool _isLoading = true;
  String? _error;
  String _filter = 'Tous';

  final List<String> _filters = [
    'Tous',
    'Étudiant',
    'Agent universitaire',
    'Administrateur',
  ];

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  Future<void> _loadUsers() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final result = await ApiService.getUsers();

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      if (result['success'] == true) {
        _users = result['users'] ?? [];
      } else {
        _error = result['message'] ?? 'Erreur de chargement';
      }
    });
  }

  List<dynamic> get _filteredUsers {
    if (_filter == 'Tous') return _users;
    return _users.where((u) => u['user_type'] == _filter).toList();
  }

  Color _getTypeColor(String type) {
    switch (type) {
      case 'Administrateur':
        return const Color(0xFF1B5E20);
      case 'Agent universitaire':
        return Colors.teal;
      case 'Étudiant':
        return Colors.indigo;
      default:
        return Colors.grey;
    }
  }

  IconData _getTypeIcon(String type) {
    switch (type) {
      case 'Administrateur':
        return Icons.admin_panel_settings;
      case 'Agent universitaire':
        return Icons.badge;
      case 'Étudiant':
        return Icons.school;
      default:
        return Icons.person;
    }
  }

  void _onUserTap(Map<String, dynamic> user) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 8),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              ListTile(
                title: Text(
                  user['full_name'] ?? '',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(user['email'] ?? ''),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.lock_reset, color: const Color(0xFF1B5E20)),
                title: const Text('Modifier le mot de passe'),
                onTap: () {
                  Navigator.pop(ctx);
                  _showChangePasswordDialog(user);
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete_forever, color: Colors.red),
                title: const Text('Supprimer l\'utilisateur'),
                onTap: () {
                  Navigator.pop(ctx);
                  _confirmDelete(user);
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showChangePasswordDialog(Map<String, dynamic> user) async {
    final controller = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: Text('Mot de passe — ${user['full_name']}'),
          content: Form(
            key: formKey,
            child: TextFormField(
              controller: controller,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Nouveau mot de passe',
                border: OutlineInputBorder(),
              ),
              validator: (v) {
                if (v == null || v.length < 6) {
                  return 'Au moins 6 caractères';
                }
                return null;
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Annuler'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1B5E20),
                foregroundColor: Colors.white,
              ),
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  Navigator.pop(ctx, true);
                }
              },
              child: const Text('Enregistrer'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    final result = await ApiService.updateUserPassword(
      userId: user['id'] is int ? user['id'] as int : int.parse(user['id'].toString()),
      newPassword: controller.text.trim(),
    );

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result['message'] ??
              (result['success'] == true ? 'Mot de passe modifié' : 'Erreur'),
        ),
        backgroundColor: result['success'] == true ? Colors.green : Colors.red,
      ),
    );
  }

  Future<void> _confirmDelete(Map<String, dynamic> user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Supprimer ?'),
          content: Text(
            'Supprimer définitivement « ${user['full_name']} » (${user['email']}) ?\n\nCette action est irréversible.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Annuler'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                foregroundColor: Colors.white,
              ),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Supprimer'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) return;

    final result = await ApiService.deleteUser(
      user['id'] is int ? user['id'] as int : int.parse(user['id'].toString()),
    );

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result['message'] ??
              (result['success'] == true ? 'Utilisateur supprimé' : 'Erreur'),
        ),
        backgroundColor: result['success'] == true ? Colors.green : Colors.red,
      ),
    );

    if (result['success'] == true) {
      _loadUsers();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gérer les utilisateurs'),
        backgroundColor: const Color(0xFF1B5E20),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadUsers,
          ),
        ],
      ),
      body: Column(
        children: [
          SizedBox(
            height: 50,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _filters.length,
              itemBuilder: (context, index) {
                final f = _filters[index];
                final isSelected = _filter == f;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(f),
                    selected: isSelected,
                    selectedColor: Colors.green.shade100,
                    onSelected: (_) {
                      setState(() => _filter = f);
                    },
                  ),
                );
              },
            ),
          ),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(_error!, style: const TextStyle(color: Colors.red)),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: _loadUsers,
                              child: const Text('Réessayer'),
                            ),
                          ],
                        ),
                      )
                    : _filteredUsers.isEmpty
                        ? const Center(
                            child: Text(
                              'Aucun utilisateur trouvé',
                              style: TextStyle(color: Colors.grey),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _loadUsers,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(12),
                              itemCount: _filteredUsers.length,
                              itemBuilder: (context, index) {
                                final user = Map<String, dynamic>.from(
                                  _filteredUsers[index] as Map,
                                );
                                final type = user['user_type'] ?? '';
                                final isActive = user['is_active'] == 1 ||
                                    user['is_active'] == true;

                                return Card(
                                  margin: const EdgeInsets.only(bottom: 10),
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 8,
                                    ),
                                    leading: CircleAvatar(
                                      backgroundColor:
                                          _getTypeColor(type).withOpacity(0.15),
                                      child: Icon(
                                        _getTypeIcon(type),
                                        color: _getTypeColor(type),
                                      ),
                                    ),
                                    title: Text(
                                      user['full_name'] ?? '',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    subtitle: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        const SizedBox(height: 4),
                                        Text(user['email'] ?? ''),
                                        if (user['student_id'] != null) ...[
                                          const SizedBox(height: 2),
                                          Text(
                                            'Matricule : ${user['student_id']}',
                                            style: const TextStyle(fontSize: 12),
                                          ),
                                        ],
                                        const SizedBox(height: 4),
                                        Row(
                                          children: [
                                            Container(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                horizontal: 8,
                                                vertical: 2,
                                              ),
                                              decoration: BoxDecoration(
                                                color: _getTypeColor(type)
                                                    .withOpacity(0.15),
                                                borderRadius:
                                                    BorderRadius.circular(8),
                                              ),
                                              child: Text(
                                                type,
                                                style: TextStyle(
                                                  fontSize: 11,
                                                  color: _getTypeColor(type),
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            if (!isActive)
                                              Container(
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                  horizontal: 8,
                                                  vertical: 2,
                                                ),
                                                decoration: BoxDecoration(
                                                  color: Colors.red
                                                      .withOpacity(0.15),
                                                  borderRadius:
                                                      BorderRadius.circular(8),
                                                ),
                                                child: const Text(
                                                  'Inactif',
                                                  style: TextStyle(
                                                    fontSize: 11,
                                                    color: Colors.red,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                ),
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    isThreeLine: true,
                                    trailing: const Icon(Icons.more_vert),
                                    onTap: () => _onUserTap(user),
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}