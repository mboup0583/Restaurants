const API = 'http://localhost:3001';

let currentUser = null;
let allUsers = [];
let allTickets = [];
let allRefunds = [];

// ---------- HEADERS AUTH ----------
function authHeaders() {
  const token = localStorage.getItem('admin_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ---------- AUTH ----------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch(`${API}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.success) {
      errEl.textContent = data.message || 'Erreur de connexion';
      return;
    }
    if (data.user.user_type !== 'Administrateur') {
      errEl.textContent = 'Accès réservé aux administrateurs';
      return;
    }
    currentUser = data.user;
    localStorage.setItem('admin_user', JSON.stringify(currentUser));
    localStorage.setItem('admin_token', data.token);
    showApp();
  } catch {
    errEl.textContent = 'Impossible de contacter le serveur';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  currentUser = null;
  localStorage.removeItem('admin_user');
  localStorage.removeItem('admin_token');
  document.getElementById('app-page').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
});

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-page').classList.remove('hidden');
  document.getElementById('admin-name').textContent = currentUser.full_name;
  showView('dashboard');
}

// ---------- NAV ----------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    showView(btn.dataset.view);
  });
});

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  const titles = {
    dashboard: 'Dashboard',
    users: 'Utilisateurs',
    tickets: 'Tickets',
    refunds: 'Remboursements',
    prices: 'Prix des tickets',
  };
  document.getElementById('view-title').textContent = titles[name] || name;
  if (name === 'dashboard') loadDashboard();
  if (name === 'users') loadUsers();
  if (name === 'tickets') loadTickets();
  if (name === 'refunds') loadRefunds();
  if (name === 'prices') loadPrices();
}

// ---------- DASHBOARD ----------
async function loadDashboard() {
  const container = document.getElementById('stats-cards');
  container.innerHTML = '<p>Chargement...</p>';
  try {
    const res = await fetch(`${API}/api/mobile/stats`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const s = data.stats;
    const rev = s.revenue || {};
    container.innerHTML = `
      <div class="card green"><div class="label">Ventes totales</div><div class="value">${rev.total_sales || 0} FCFA</div></div>
      <div class="card orange"><div class="label">Remboursements</div><div class="value">${rev.total_refunded || 0} FCFA</div></div>
      <div class="card blue"><div class="label">Total tickets</div><div class="value">${rev.total_tickets || 0}</div></div>
      <div class="card teal"><div class="label">Tickets (7 jours)</div><div class="value">${s.tickets_last_7_days || 0}</div></div>
    `;
  } catch (e) {
    container.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

// ---------- USERS ----------
async function loadUsers() {
  try {
    const res = await fetch(`${API}/api/mobile/users`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    allUsers = data.users || [];
    renderUsers();
  } catch (e) {
    document.getElementById('users-tbody').innerHTML =
      `<tr><td colspan="7">${e.message}</td></tr>`;
  }
}

function renderUsers() {
  const filter = document.getElementById('user-filter').value;
  const list = filter === 'Tous' ? allUsers : allUsers.filter((u) => u.user_type === filter);
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = list.map((u) => {
    const typeClass =
      u.user_type === 'Administrateur' ? 'badge-admin' :
      u.user_type === 'Agent universitaire' ? 'badge-agent' : 'badge-student';
    const active = u.is_active == 1 || u.is_active === true;
    return `
      <tr>
        <td>${u.id}</td>
        <td>${u.full_name || ''}</td>
        <td>${u.email || ''}</td>
        <td><span class="badge ${typeClass}">${u.user_type || ''}</span></td>
        <td>${u.student_id || '—'}</td>
        <td>${active ? 'Actif' : 'Inactif'}</td>
        <td>
          <button class="btn-sm btn-edit" onclick="openEditUser(${u.id})">Modifier</button>
          <button class="btn-sm btn-delete" onclick="deleteUser(${u.id})">Supprimer</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('user-filter').addEventListener('change', renderUsers);
document.getElementById('refresh-users').addEventListener('click', loadUsers);

function openEditUser(id) {
  const u = allUsers.find((x) => x.id === id);
  if (!u) return;
  document.getElementById('edit-user-id').value = u.id;
  document.getElementById('edit-full-name').value = u.full_name || '';
  document.getElementById('edit-email').value = u.email || '';
  document.getElementById('edit-password').value = '';
  document.getElementById('edit-active').checked = u.is_active == 1 || u.is_active === true;
  document.getElementById('edit-user-error').textContent = '';
  document.getElementById('modal-user').classList.remove('hidden');
}

document.getElementById('cancel-edit-user').addEventListener('click', () => {
  document.getElementById('modal-user').classList.add('hidden');
});

document.getElementById('save-edit-user').addEventListener('click', async () => {
  const id = document.getElementById('edit-user-id').value;
  const body = {
    full_name: document.getElementById('edit-full-name').value.trim(),
    email: document.getElementById('edit-email').value.trim(),
    is_active: document.getElementById('edit-active').checked,
  };
  const pwd = document.getElementById('edit-password').value;
  if (pwd) body.password = pwd;

  const errEl = document.getElementById('edit-user-error');
  errEl.textContent = '';

  try {
    const res = await fetch(`${API}/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) {
      errEl.textContent = data.message || 'Erreur';
      return;
    }
    document.getElementById('modal-user').classList.add('hidden');
    loadUsers();
  } catch {
    errEl.textContent = 'Erreur réseau';
  }
});

async function deleteUser(id) {
  if (!confirm('Supprimer cet utilisateur définitivement ?')) return;
  try {
    const res = await fetch(`${API}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'Erreur');
      return;
    }
    loadUsers();
  } catch {
    alert('Erreur réseau');
  }
}

// ---------- TICKETS ----------
async function loadTickets() {
  try {
    const res = await fetch(`${API}/api/mobile/tickets`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    allTickets = data.tickets || [];
    renderTickets();
  } catch (e) {
    document.getElementById('tickets-tbody').innerHTML =
      `<tr><td colspan="7">${e.message}</td></tr>`;
  }
}

function renderTickets() {
  const filter = document.getElementById('ticket-filter').value;
  const list = filter === 'Tous' ? allTickets : allTickets.filter((t) => t.status === filter);
  const statusClass = {
    ACTIVE: 'badge-active', USED: 'badge-used',
    TRANSFERRED: 'badge-transferred', REFUNDED: 'badge-refunded',
  };
  const statusLabel = {
    ACTIVE: 'Actif', USED: 'Utilisé',
    TRANSFERRED: 'Transféré', REFUNDED: 'Remboursé',
  };
  document.getElementById('tickets-tbody').innerHTML = list.map((t) => {
    const date = t.created_at ? new Date(t.created_at).toLocaleString('fr-FR') : '';
    return `
      <tr>
        <td style="font-family:monospace;font-size:.8rem">${t.ticket_code || ''}</td>
        <td>${t.type || ''}</td>
        <td>${t.price || ''} FCFA</td>
        <td>${t.full_name || '—'}</td>
        <td>${t.payment_method || '—'}</td>
        <td><span class="badge ${statusClass[t.status] || ''}">${statusLabel[t.status] || t.status}</span></td>
        <td>${date}</td>
      </tr>
    `;
  }).join('');
}

document.getElementById('ticket-filter').addEventListener('change', renderTickets);
document.getElementById('refresh-tickets').addEventListener('click', loadTickets);

// ---------- REMBOURSEMENTS ----------
async function loadRefunds() {
  try {
    const res = await fetch(`${API}/api/admin/refunds`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    allRefunds = data.refunds || [];
    renderRefunds();
  } catch (e) {
    document.getElementById('refunds-tbody').innerHTML =
      `<tr><td colspan="8">${e.message}</td></tr>`;
  }
}

function renderRefunds() {
  const statusLabel = { PENDING: 'En attente', COMPLETED: 'Accepté', REJECTED: 'Refusé' };
  const statusClass = {
    PENDING: 'badge-transferred', COMPLETED: 'badge-active', REJECTED: 'badge-refunded',
  };
  document.getElementById('refunds-tbody').innerHTML = allRefunds.map((r) => {
    const date = r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '';
    const actions = r.status === 'PENDING'
      ? `<button class="btn-sm btn-ok" onclick="processRefund(${r.id},'COMPLETED')">Accepter</button>
         <button class="btn-sm btn-no" onclick="processRefund(${r.id},'REJECTED')">Refuser</button>`
      : '—';
    return `
      <tr>
        <td>${r.id}</td>
        <td>${r.full_name || ''} <br><small>${r.email || ''}</small></td>
        <td>${r.ticket_type || ''} <br><small style="font-family:monospace">${r.ticket_code || ''}</small></td>
        <td>${r.amount} FCFA</td>
        <td>${r.payment_method || ''}</td>
        <td><span class="badge ${statusClass[r.status] || ''}">${statusLabel[r.status] || r.status}</span></td>
        <td>${date}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8">Aucun remboursement</td></tr>';
}

async function processRefund(id, status) {
  const label = status === 'COMPLETED' ? 'accepter' : 'refuser';
  if (!confirm(`Voulez-vous ${label} ce remboursement ?`)) return;
  try {
    const res = await fetch(`${API}/api/admin/refunds/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status, processed_by: currentUser.id }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'Erreur');
      return;
    }
    loadRefunds();
  } catch {
    alert('Erreur réseau');
  }
}

document.getElementById('refresh-refunds').addEventListener('click', loadRefunds);

// ---------- PRIX ----------
async function loadPrices() {
  try {
    const res = await fetch(`${API}/api/admin/prices`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    document.getElementById('price-pdj').value = data.prices.petit_dejeuner;
    document.getElementById('price-repas').value = data.prices.repas;
    document.getElementById('prices-msg').textContent = '';
  } catch (e) {
    document.getElementById('prices-msg').textContent = e.message;
    document.getElementById('prices-msg').className = 'msg err';
  }
}

document.getElementById('save-prices').addEventListener('click', async () => {
  const petit_dejeuner = parseInt(document.getElementById('price-pdj').value, 10);
  const repas = parseInt(document.getElementById('price-repas').value, 10);
  const msg = document.getElementById('prices-msg');

  if (isNaN(petit_dejeuner) || isNaN(repas) || petit_dejeuner < 0 || repas < 0) {
    msg.textContent = 'Prix invalides';
    msg.className = 'msg err';
    return;
  }

  try {
    const res = await fetch(`${API}/api/admin/prices`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ petit_dejeuner, repas }),
    });
    const data = await res.json();
    if (!data.success) {
      msg.textContent = data.message || 'Erreur';
      msg.className = 'msg err';
      return;
    }
    msg.textContent = 'Prix enregistrés';
    msg.className = 'msg ok';
  } catch {
    msg.textContent = 'Erreur réseau';
    msg.className = 'msg err';
  }
});

// ---------- INIT ----------
const saved = localStorage.getItem('admin_user');
const token = localStorage.getItem('admin_token');
if (saved && token) {
  try {
    currentUser = JSON.parse(saved);
    if (currentUser.user_type === 'Administrateur') showApp();
  } catch (_) {}
}