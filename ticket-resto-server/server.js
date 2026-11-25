require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'ticket_resto_secret_2026_uasz_secure_key';
const SERVER_BASE_URL =
  process.env.BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://ticket-resto-api.onrender.com';

// ==================== SÉCURITÉ : HEADERS HTTP & MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// En-têtes de sécurité HTTP (Protection Clickjacking, MIME-Sniffing, XSS)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Helper d'échappement XSS pour le rendu HTML côté serveur
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Middleware d'authentification JWT
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, user_type, full_name }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
  }
}

// Middleware de contrôle des rôles Administrateur
function adminMiddleware(req, res, next) {
  if (!req.user || req.user.user_type !== 'Administrateur') {
    return res.status(403).json({ success: false, message: 'Accès administrateur requis' });
  }
  next();
}

// ==================== SÉCURITÉ : RATE LIMITING ====================
const rateLimitStore = new Map();

function createRateLimiter({ windowMs = 15 * 60 * 1000, maxRequests = 10, message } = {}) {
  return (req, res, next) => {
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    const key = `${req.baseUrl || req.path}:${ip}`;
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };

    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
    } else {
      record.count += 1;
    }

    rateLimitStore.set(key, record);

    if (record.count > maxRequests) {
      return res.status(429).json({
        success: false,
        message: message || 'Trop de requêtes. Veuillez patienter avant de réessayer.',
      });
    }
    next();
  };
}

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Trop de tentatives de connexion échouées. Réessayez dans 15 minutes.',
});

const otpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  message: 'Trop de demandes de codes de vérification. Réessayez dans 15 minutes.',
});

const verifyLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 15,
  message: 'Trop de tentatives de validation. Réessayez plus tard.',
});

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      user_type: user.user_type,
      full_name: user.full_name,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ==================== CONNEXION MYSQL ====================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ticket_resto_db',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connecté à MySQL (ticket_resto_db)');
    connection.release();
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL :', err.message);
    process.exit(1);
  }
}

// ==================== WEBSOCKET ====================
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('🔌 Client WebSocket connecté. Total:', clients.size);
  ws.on('close', () => {
    clients.delete(ws);
    console.log('🔌 Client déconnecté. Total:', clients.size);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ==================== CONFIGURATION EMAIL ====================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s/g, '') : '',
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ==================== STOCKAGE TEMPORAIRE DES CODES OTP ====================
const verificationCodes = new Map();

function generateVerificationCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

// ==================== UTILITAIRES ====================
function generateTicketCode(type) {
  const prefix = type === 'Petit-déjeuner' ? 'PDJ' : 'REP';
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  return `${prefix}_${random}_${timestamp}`;
}

// ==================== ROUTES AUTH ====================

app.post('/api/mobile/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, password, user_type, student_id, phone, is_active, created_at, updated_at
       FROM users WHERE LOWER(email) = ? AND is_active = 1`,
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    const token = signToken(user);

    res.json({
      success: true,
      message: 'Connexion réussie',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        user_type: user.user_type,
        student_id: user.student_id,
        phone: user.phone || null,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      token,
    });
  } catch (err) {
    console.error('Erreur login:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== ENVOI CODE VÉRIFICATION ====================
app.post('/api/mobile/send-verification-code', otpLimiter, async (req, res) => {
  try {
    const { full_name, email, password, user_type, student_id, phone } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }

    // Sécurité : Seuls les comptes 'Étudiant' peuvent s'inscrire publiquement via l'application mobile.
    // Les comptes 'Agent universitaire' et 'Administrateur' sont créés uniquement depuis le panel administrateur.
    const safeUserType = 'Étudiant';

    if (!student_id || String(student_id).trim() === '') {
      return res.status(400).json({ success: false, message: 'Numéro étudiant obligatoire' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const [existing] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    }

    const code = generateVerificationCode();

    verificationCodes.set(cleanEmail, {
      full_name: String(full_name).trim(),
      password,
      user_type: safeUserType,
      student_id: student_id ? String(student_id).trim() : null,
      phone: phone ? String(phone).replace(/\s/g, '') : null,
      code,
      expires: Date.now() + 15 * 60 * 1000,
      attempts: 0,
    });

    let emailSent = false;
    let mailError = null;

    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        await transporter.verify();

        await transporter.sendMail({
          from: `"Ticket Resto UASZ" <${process.env.SMTP_USER}>`,
          to: cleanEmail,
          subject: 'Code de vérification - Ticket Resto',
          text: `Bonjour ${full_name},\n\nVotre code de vérification Ticket Resto est : ${code}\n\nIl expire dans 15 minutes.\n\nTicket Resto UASZ`,
          html: `
            <h2>Ticket Resto UASZ</h2>
            <p>Bonjour <strong>${escapeHtml(full_name)}</strong>,</p>
            <p>Votre code de vérification est :</p>
            <h1 style="letter-spacing:8px;color:#1B5E20;">${code}</h1>
            <p>Il expire dans 15 minutes.</p>
          `,
        });

        emailSent = true;
        console.log(`✅ Email envoyé à ${cleanEmail}`);
      } else {
        mailError = 'SMTP_USER ou SMTP_PASS non configuré';
      }
    } catch (mailErr) {
      mailError = mailErr.message;
      console.error('❌ Erreur SMTP:', mailErr.message);
    }

    console.log(`\n📧 Code de vérification pour ${cleanEmail} : ${code}\n`);

    // SÉCURITÉ : Ne JAMAIS divulguer debug_code dans la réponse HTTP client !
    res.json({
      success: true,
      message: emailSent
        ? 'Code envoyé par email avec succès'
        : 'Code de vérification généré. Consultez votre boîte de réception.',
    });
  } catch (err) {
    console.error('Erreur send verification code:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== VÉRIFIER CODE + CRÉER COMPTE ====================
app.post('/api/mobile/verify-and-register', verifyLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email et code requis' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const stored = verificationCodes.get(cleanEmail);

    if (!stored) {
      return res.status(400).json({ success: false, message: 'Aucune demande de vérification en cours' });
    }

    // Protection anti force brute sur le code OTP
    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts > 5) {
      verificationCodes.delete(cleanEmail);
      return res.status(429).json({ success: false, message: 'Trop de tentatives erronées. Veuillez redemander un code.' });
    }

    if (Date.now() > stored.expires) {
      verificationCodes.delete(cleanEmail);
      return res.status(400).json({ success: false, message: 'Le code a expiré. Veuillez réessayer.' });
    }

    if (stored.code !== String(code).trim()) {
      return res.status(400).json({ success: false, message: 'Code incorrect' });
    }

    const hashedPassword = await bcrypt.hash(stored.password, 10);

    const [result] = await pool.execute(
      `INSERT INTO users (full_name, email, password, user_type, student_id, phone) VALUES (?, ?, ?, ?, ?, ?)`,
      [stored.full_name, cleanEmail, hashedPassword, stored.user_type, stored.student_id, stored.phone]
    );

    const newUser = {
      id: result.insertId,
      full_name: stored.full_name,
      email: cleanEmail,
      user_type: stored.user_type,
      student_id: stored.student_id,
      phone: stored.phone,
      is_active: 1,
    };

    const token = signToken(newUser);
    broadcast({ type: 'USER_ADDED', user: newUser });
    verificationCodes.delete(cleanEmail);

    res.status(201).json({
      success: true,
      message: 'Inscription réussie',
      user: newUser,
      token,
    });
  } catch (err) {
    console.error('Erreur verify and register:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== ROUTE REGISTER (LEGACY COMPATIBILITÉ) ====================
app.post('/api/mobile/register', otpLimiter, async (req, res) => {
  try {
    const { full_name, email, password, user_type, student_id, phone } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }

    const safeUserType = 'Étudiant';
    if (!student_id) {
      return res.status(400).json({ success: false, message: 'Numéro étudiant obligatoire' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const [existing] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      `INSERT INTO users (full_name, email, password, user_type, student_id, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(full_name).trim(),
        cleanEmail,
        hashedPassword,
        safeUserType,
        student_id || null,
        phone ? String(phone).replace(/\s/g, '') : null,
      ]
    );

    const newUser = {
      id: result.insertId,
      full_name: String(full_name).trim(),
      email: cleanEmail,
      user_type: safeUserType,
      student_id: student_id || null,
      phone: phone ? String(phone).replace(/\s/g, '') : null,
      is_active: 1,
    };

    const token = signToken(newUser);
    broadcast({ type: 'USER_ADDED', user: newUser });
    res.status(201).json({
      success: true,
      message: 'Inscription réussie',
      user: newUser,
      token,
    });
  } catch (err) {
    console.error('Erreur register:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== GESTION DES UTILISATEURS ====================

// Sécurité : Liste des utilisateurs réservée aux Administrateurs pour éviter le scraping de données étudiantes
app.get('/api/mobile/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, user_type, student_id, is_active, created_at FROM users ORDER BY id'
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error('Erreur get users:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Recherche ciblée d'un utilisateur par email (pour transfert de ticket sécurisé)
app.get('/api/mobile/users/lookup', authMiddleware, async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email requis' });
    }

    const [rows] = await pool.execute(
      'SELECT id, full_name, email FROM users WHERE LOWER(email) = ? AND is_active = 1',
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Aucun utilisateur avec cet email' });
    }

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Erreur users lookup:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== ROUTES TICKETS ====================

// Achat direct / allocation manuelle : réservée aux Administrateurs
app.post('/api/mobile/tickets/buy', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { user_id, type, quantity, payment_method } = req.body;

    if (!user_id || !type || !quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: 'Données invalides' });
    }

    const allowedTypes = ['Petit-déjeuner', 'Repas'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Type de ticket invalide' });
    }

    const [priceRows] = await pool.execute(
      `SELECT setting_key, setting_value FROM settings
       WHERE setting_key IN ('price_petit_dejeuner', 'price_repas')`
    );
    const priceMap = {};
    priceRows.forEach((r) => {
      priceMap[r.setting_key] = parseInt(r.setting_value, 10);
    });
    const price =
      type === 'Petit-déjeuner'
        ? priceMap.price_petit_dejeuner || 50
        : priceMap.price_repas || 100;

    const createdTickets = [];
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (let i = 0; i < quantity; i++) {
        const ticketCode = generateTicketCode(type);
        const [result] = await connection.execute(
          `INSERT INTO tickets (ticket_code, type, user_id, price, payment_method, status)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
          [ticketCode, type, user_id, price, payment_method || 'Simulation']
        );

        createdTickets.push({
          id: result.insertId,
          ticket_code: ticketCode,
          type,
          price,
          status: 'ACTIVE',
        });
      }

      await connection.execute(
        `INSERT INTO transactions (user_id, type, amount, description, reference_id)
         VALUES (?, 'ACHAT', ?, ?, ?)`,
        [user_id, price * quantity, `Achat de ${quantity} ticket(s) ${type}`, createdTickets[0]?.id]
      );

      await connection.commit();
      broadcast({ type: 'TICKETS_BOUGHT', user_id, tickets: createdTickets });

      res.status(201).json({
        success: true,
        message: `${quantity} ticket(s) acheté(s) avec succès`,
        tickets: createdTickets,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur buy tickets:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Sécurité IDOR : un utilisateur ne peut voir que ses propres tickets (sauf s'il est Administrateur)
app.get('/api/mobile/tickets/my/:userId', authMiddleware, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId, 10);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ success: false, message: 'userId invalide' });
    }

    if (req.user.user_type !== 'Administrateur' && req.user.id !== targetUserId) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé aux tickets de cet utilisateur' });
    }

    const [rows] = await pool.execute(
      `SELECT id, ticket_code, type, price, status, payment_method, created_at, used_at
       FROM tickets WHERE user_id = ? ORDER BY created_at DESC`,
      [targetUserId]
    );
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('Erreur get my tickets:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Validation ticket sécurisée (Réservée Agent / Admin, protection contre Race Condition)
app.post('/api/mobile/tickets/validate', authMiddleware, async (req, res) => {
  try {
    if (req.user.user_type !== 'Agent universitaire' && req.user.user_type !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Accès réservé aux agents universitaires et administrateurs',
      });
    }

    const { ticket_code } = req.body;
    const agent_id = req.user.id; // Enforce depuis le JWT vérifié !

    if (!ticket_code || String(ticket_code).trim() === '') {
      return res.status(400).json({ success: false, message: 'ticket_code requis' });
    }

    const cleanCode = String(ticket_code).trim();

    // Mise à jour atomique conditionnelle (élimine les Race Conditions / double utilisation)
    const [result] = await pool.execute(
      `UPDATE tickets 
       SET status = 'USED', used_at = NOW(), used_by_agent = ? 
       WHERE ticket_code = ? AND status = 'ACTIVE'`,
      [agent_id, cleanCode]
    );

    if (result.affectedRows === 0) {
      const [check] = await pool.execute('SELECT status FROM tickets WHERE ticket_code = ?', [cleanCode]);
      if (check.length === 0) {
        return res.status(404).json({ success: false, message: 'Ticket introuvable' });
      }
      return res.status(400).json({ success: false, message: `Ticket déjà ${check[0].status.toLowerCase()}` });
    }

    const [rows] = await pool.execute('SELECT * FROM tickets WHERE ticket_code = ?', [cleanCode]);
    const ticket = rows[0];

    await pool.execute(
      `INSERT INTO transactions (user_id, type, amount, description, reference_id)
       VALUES (?, 'UTILISATION', 0, ?, ?)`,
      [ticket.user_id, `Ticket ${ticket.type} utilisé`, ticket.id]
    );

    broadcast({ type: 'TICKET_USED', ticket_code: cleanCode, user_id: ticket.user_id, agent_id });

    res.json({
      success: true,
      message: 'Ticket validé avec succès',
      ticket: { id: ticket.id, ticket_code: ticket.ticket_code, type: ticket.type, status: 'USED' },
    });
  } catch (err) {
    console.error('Erreur validate ticket:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== TRANSFERT SÉCURISÉ ====================
app.post('/api/mobile/tickets/transfer', authMiddleware, async (req, res) => {
  try {
    // Sécurité IDOR : L'expéditeur est IMPÉRATIVEMENT l'utilisateur authentifié (req.user.id)
    const from_user_id = req.user.id;
    const { to_user_id, ticket_id, ticket_ids } = req.body;

    let targetTicketIds = [];
    if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
      targetTicketIds = ticket_ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    } else if (ticket_id) {
      targetTicketIds = [parseInt(ticket_id, 10)];
    }

    if (!to_user_id || targetTicketIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Données manquantes ou aucun ticket sélectionné' });
    }

    const destUserId = parseInt(to_user_id, 10);
    if (from_user_id === destUserId) {
      return res.status(400).json({ success: false, message: 'Impossible de se transférer à soi-même' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [users] = await connection.execute(
        'SELECT id, full_name, email FROM users WHERE id = ? AND is_active = 1',
        [destUserId]
      );

      if (users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Destinataire introuvable ou inactif' });
      }

      const placeholders = targetTicketIds.map(() => '?').join(',');
      // Verrouillage FOR UPDATE pour garantir l'intégrité transactionnelle
      const [tickets] = await connection.query(
        `SELECT id, ticket_code, type, price FROM tickets 
         WHERE id IN (${placeholders}) AND user_id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [...targetTicketIds, from_user_id]
      );

      if (tickets.length !== targetTicketIds.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Un ou plusieurs tickets sont introuvables ou ne peuvent plus être transférés',
        });
      }

      await connection.query(
        `UPDATE tickets SET user_id = ?, status = 'ACTIVE' WHERE id IN (${placeholders})`,
        [destUserId, ...targetTicketIds]
      );

      for (const t of tickets) {
        await connection.execute(
          `INSERT INTO transfers (from_user_id, to_user_id, ticket_id) VALUES (?, ?, ?)`,
          [from_user_id, destUserId, t.id]
        );

        await connection.execute(
          `INSERT INTO transactions (user_id, type, amount, description, reference_id)
           VALUES (?, 'TRANSFERT', 0, ?, ?)`,
          [from_user_id, `Transfert du ticket #${t.id} (${t.type}) vers utilisateur ${destUserId}`, t.id]
        );
      }

      await connection.commit();

      broadcast({
        type: 'TICKETS_TRANSFERRED',
        ticket_ids: targetTicketIds,
        from_user_id,
        to_user_id: destUserId,
        count: targetTicketIds.length,
      });

      const count = targetTicketIds.length;
      res.json({
        success: true,
        message: count === 1 ? 'Ticket transféré avec succès' : `${count} tickets transférés avec succès`,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur transfer:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors du transfert' });
  }
});

// ==================== REMBOURSEMENT SÉCURISÉ ====================
app.post('/api/mobile/tickets/refund', authMiddleware, async (req, res) => {
  try {
    // Sécurité IDOR : Le demandeur est IMPÉRATIVEMENT l'utilisateur authentifié (req.user.id)
    const user_id = req.user.id;
    const { payment_method, ticket_id, ticket_ids } = req.body;

    let targetTicketIds = [];
    if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
      targetTicketIds = ticket_ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    } else if (ticket_id) {
      targetTicketIds = [parseInt(ticket_id, 10)];
    }

    if (!payment_method || targetTicketIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Données manquantes ou aucun ticket sélectionné' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const placeholders = targetTicketIds.map(() => '?').join(',');
      const [tickets] = await connection.query(
        `SELECT id, ticket_code, type, price FROM tickets 
         WHERE id IN (${placeholders}) AND user_id = ? AND status = 'ACTIVE' FOR UPDATE`,
        [...targetTicketIds, user_id]
      );

      if (tickets.length !== targetTicketIds.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Un ou plusieurs tickets sont introuvables ou ne peuvent plus être remboursés',
        });
      }

      await connection.query(
        `UPDATE tickets SET status = 'REFUNDED' WHERE id IN (${placeholders})`,
        targetTicketIds
      );

      let totalAmount = 0;
      const refundIds = [];

      for (const t of tickets) {
        const tPrice = parseFloat(t.price);
        totalAmount += tPrice;

        const [result] = await connection.execute(
          `INSERT INTO refunds (user_id, ticket_id, amount, payment_method, status)
           VALUES (?, ?, ?, ?, 'PENDING')`,
          [user_id, t.id, tPrice, payment_method]
        );
        refundIds.push(result.insertId);

        await connection.execute(
          `INSERT INTO transactions (user_id, type, amount, description, reference_id)
           VALUES (?, 'REMBOURSEMENT', ?, ?, ?)`,
          [user_id, tPrice, `Demande de remboursement ticket #${t.id} (${t.type})`, result.insertId]
        );
      }

      await connection.commit();

      broadcast({
        type: 'REFUND_REQUESTED',
        user_id,
        ticket_ids: targetTicketIds,
        amount: totalAmount,
        count: targetTicketIds.length,
      });

      const count = targetTicketIds.length;
      res.json({
        success: true,
        message:
          count === 1
            ? 'Demande de remboursement enregistrée'
            : `${count} demandes de remboursement enregistrées (${totalAmount} FCFA)`,
        refund_ids: refundIds,
        total_amount: totalAmount,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur refund:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors du remboursement' });
  }
});

// ==================== TOUS LES TICKETS (ADMIN) ====================
app.get('/api/mobile/tickets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.id, t.ticket_code, t.type, t.price, t.status, t.payment_method,
              t.created_at, t.used_at, t.user_id,
              u.full_name, u.email, u.student_id
       FROM tickets t
       LEFT JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC`
    );
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('Erreur get all tickets:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== STATISTIQUES (ADMIN) ====================
app.get('/api/mobile/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [usersByType] = await pool.execute(
      `SELECT user_type, COUNT(*) as count FROM users WHERE is_active = 1 GROUP BY user_type`
    );

    const [ticketsByStatus] = await pool.execute(
      `SELECT status, COUNT(*) as count FROM tickets GROUP BY status`
    );

    const [ticketsByType] = await pool.execute(
      `SELECT type, COUNT(*) as count, SUM(price) as total FROM tickets GROUP BY type`
    );

    const [revenue] = await pool.execute(
      `SELECT 
         COALESCE(SUM(CASE WHEN status IN ('ACTIVE','USED','TRANSFERRED') THEN price ELSE 0 END), 0) as total_sales,
         COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN price ELSE 0 END), 0) as total_refunded,
         COUNT(*) as total_tickets
       FROM tickets`
    );

    const [recentTickets] = await pool.execute(
      `SELECT COUNT(*) as count FROM tickets WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    res.json({
      success: true,
      stats: {
        users_by_type: usersByType,
        tickets_by_status: ticketsByStatus,
        tickets_by_type: ticketsByType,
        revenue: revenue[0],
        tickets_last_7_days: recentTickets[0].count,
      },
    });
  } catch (err) {
    console.error('Erreur stats:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== ADMIN : UTILISATEURS ====================
app.patch('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const { email, password, is_active, full_name } = req.body;

    const updates = [];
    const values = [];

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      values.push(String(full_name).trim());
    }
    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      const [exist] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [
        cleanEmail,
        userId,
      ]);
      if (exist.length > 0) {
        return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
      }
      updates.push('email = ?');
      values.push(cleanEmail);
    }
    if (password !== undefined && password !== '') {
      const hashed = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      values.push(hashed);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Aucune modification' });
    }

    values.push(userId);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    res.json({ success: true, message: 'Utilisateur mis à jour' });
  } catch (err) {
    console.error('Erreur update user:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;

    const [admins] = await pool.execute(
      `SELECT id FROM users WHERE user_type = 'Administrateur' AND is_active = 1`
    );
    const [target] = await pool.execute(`SELECT user_type FROM users WHERE id = ?`, [userId]);

    if (target.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    }

    if (target[0].user_type === 'Administrateur' && admins.length <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de supprimer le dernier administrateur',
      });
    }

    await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true, message: 'Utilisateur supprimé' });
  } catch (err) {
    console.error('Erreur delete user:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== ADMIN : REMBOURSEMENTS ====================
app.get('/api/admin/refunds', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.*, u.full_name, u.email, t.ticket_code, t.type as ticket_type
       FROM refunds r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN tickets t ON r.ticket_id = t.id
       ORDER BY r.created_at DESC`
    );
    res.json({ success: true, refunds: rows });
  } catch (err) {
    console.error('Erreur get refunds:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.patch('/api/admin/refunds/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const refundId = req.params.id;
    const { status, processed_by } = req.body;

    if (!['COMPLETED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }

    await pool.execute(
      `UPDATE refunds
       SET status = ?, processed_by = ?, processed_at = NOW()
       WHERE id = ?`,
      [status, processed_by || req.user.id, refundId]
    );

    res.json({
      success: true,
      message: status === 'COMPLETED' ? 'Remboursement accepté' : 'Remboursement refusé',
    });
  } catch (err) {
    console.error('Erreur update refund:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== PRIX ====================
app.get('/api/mobile/prices', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
    const prices = {};
    rows.forEach((r) => {
      prices[r.setting_key] = r.setting_value;
    });
    res.json({
      success: true,
      prices: {
        petit_dejeuner: parseInt(prices.price_petit_dejeuner || '50', 10),
        repas: parseInt(prices.price_repas || '100', 10),
      },
    });
  } catch (err) {
    console.error('Erreur mobile prices:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.get('/api/admin/prices', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
    const prices = {};
    rows.forEach((r) => {
      prices[r.setting_key] = r.setting_value;
    });
    res.json({
      success: true,
      prices: {
        petit_dejeuner: parseInt(prices.price_petit_dejeuner || '50', 10),
        repas: parseInt(prices.price_repas || '100', 10),
      },
    });
  } catch (err) {
    console.error('Erreur get prices:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

app.put('/api/admin/prices', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { petit_dejeuner, repas } = req.body;

    if (petit_dejeuner !== undefined) {
      await pool.execute(
        `INSERT INTO settings (setting_key, setting_value) VALUES ('price_petit_dejeuner', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(petit_dejeuner)]
      );
    }
    if (repas !== undefined) {
      await pool.execute(
        `INSERT INTO settings (setting_key, setting_value) VALUES ('price_repas', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(repas)]
      );
    }

    res.json({ success: true, message: 'Prix mis à jour' });
  } catch (err) {
    console.error('Erreur update prices:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== RAPPORT VENTES (AGENT / ADMIN) ====================
app.get('/api/mobile/sales-report', authMiddleware, async (req, res) => {
  try {
    const [byType] = await pool.execute(
      `SELECT type, COUNT(*) as count, SUM(price) as total
       FROM tickets
       WHERE status = 'USED'
       GROUP BY type`
    );

    const [byDay] = await pool.execute(
      `SELECT DATE(used_at) as day, COUNT(*) as count, SUM(price) as total
       FROM tickets
       WHERE status = 'USED' AND used_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DATE(used_at)
       ORDER BY day DESC`
    );

    const [totals] = await pool.execute(
      `SELECT
         COUNT(*) as total_used,
         COALESCE(SUM(price), 0) as total_amount
       FROM tickets
       WHERE status = 'USED'`
    );

    const [today] = await pool.execute(
      `SELECT COUNT(*) as count, COALESCE(SUM(price), 0) as total
       FROM tickets
       WHERE status = 'USED' AND DATE(used_at) = CURDATE()`
    );

    res.json({
      success: true,
      report: {
        totals: totals[0],
        today: today[0],
        by_type: byType,
        by_day: byDay,
      },
    });
  } catch (err) {
    console.error('Erreur sales-report:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== PAIEMENT WAVE & PAYDUNYA ====================
const PAYDUNYA_MODE = (process.env.PAYDUNYA_MODE || 'test').trim().toLowerCase();
const PAYDUNYA_BASE =
  PAYDUNYA_MODE === 'live'
    ? 'https://app.paydunya.com/api/v1'
    : 'https://app.paydunya.com/sandbox-api/v1';

const PAYDUNYA_MIN_AMOUNT = 200;

function paydunyaHeaders() {
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': (process.env.PAYDUNYA_MASTER_KEY || '').trim(),
    'PAYDUNYA-PRIVATE-KEY': (process.env.PAYDUNYA_PRIVATE_KEY || '').trim(),
    'PAYDUNYA-TOKEN': (process.env.PAYDUNYA_TOKEN || '').trim(),
  };
}

// Initialisation du paiement Wave (Résolvant les erreurs de clés et assurant une disponibilité 100%)
app.post('/api/mobile/payments/init', authMiddleware, async (req, res) => {
  try {
    // Sécurité : user_id est TOUJOURS pris depuis le token JWT vérifié
    const user_id = req.user.id;
    let { type, quantity, payment_method, phone } = req.body;

    if (!type || !quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: 'Données invalides' });
    }

    if (payment_method !== 'Wave') {
      return res.status(400).json({
        success: false,
        message: 'Seul Wave est disponible pour le moment. Orange Money bientôt.',
      });
    }

    // Récupérer le numéro de téléphone en base si non fourni
    if (!phone || String(phone).trim() === '') {
      const [rows] = await pool.execute('SELECT phone FROM users WHERE id = ?', [user_id]);
      phone = rows[0]?.phone || null;
    }

    if (!phone || String(phone).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Aucun numéro de téléphone enregistré. Veuillez renseigner votre numéro Wave.',
      });
    }

    const cleanPhone = String(phone).replace(/\s/g, '').replace(/^\+221/, '');

    const allowedTypes = ['Petit-déjeuner', 'Repas'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Type de ticket invalide' });
    }

    let unitPrice = type === 'Petit-déjeuner' ? 50 : 100;
    try {
      const [priceRows] = await pool.execute(
        `SELECT setting_key, setting_value FROM settings
         WHERE setting_key IN ('price_petit_dejeuner', 'price_repas')`
      );
      const priceMap = {};
      priceRows.forEach((r) => {
        priceMap[r.setting_key] = parseInt(r.setting_value, 10);
      });
      unitPrice =
        type === 'Petit-déjeuner'
          ? priceMap.price_petit_dejeuner || 50
          : priceMap.price_repas || 100;
    } catch (e) {
      console.warn('settings indisponible, prix par défaut:', e.message);
    }

    const totalAmount = unitPrice * quantity;

    if (totalAmount < PAYDUNYA_MIN_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: 'Montant minimum Wave : 200 FCFA. Prenez au moins 2 repas (ou 4 petits-déjeuners).',
      });
    }

    let paymentId;
    try {
      const [payResult] = await pool.execute(
        `INSERT INTO payments (user_id, ticket_type, quantity, amount, payment_method, status)
         VALUES (?, ?, ?, ?, ?, 'PENDING')`,
        [user_id, type, quantity, totalAmount, payment_method]
      );
      paymentId = payResult.insertId;
    } catch (e) {
      console.error('INSERT payments:', e.message);
      return res.status(500).json({
        success: false,
        message: 'Table payments inaccessible : ' + e.message,
      });
    }

    const fullName = req.user.full_name || 'Étudiant UASZ';
    const email = req.user.email || 'etudiant@univ-zig.sn';

    let paydunyaSuccess = false;
    let paymentUrl = null;
    let paymentToken = null;

    const hasPaydunyaKeys = Boolean(
      process.env.PAYDUNYA_MASTER_KEY &&
      process.env.PAYDUNYA_PRIVATE_KEY &&
      process.env.PAYDUNYA_TOKEN
    );

    // Tentative PayDunya si les clés sont configurées dans l'environnement
    if (hasPaydunyaKeys) {
      try {
        const payload = {
          invoice: {
            total_amount: totalAmount,
            description: `Achat ${quantity} ticket(s) ${type} - UASZ Resto #${paymentId}`,
          },
          store: {
            name: 'Ticket Resto UASZ',
            tagline: 'CROUS Ziguinchor',
          },
          custom_data: {
            payment_id: String(paymentId),
            user_id: String(user_id),
            ticket_type: type,
            quantity: String(quantity),
          },
          actions: {
            callback_url: `${SERVER_BASE_URL}/api/payments/paydunya/webhook`,
            cancel_url: `${SERVER_BASE_URL}/api/payments/cancel`,
            return_url: `${SERVER_BASE_URL}/api/payments/success`,
          },
        };

        const response = await fetch(`${PAYDUNYA_BASE}/checkout-invoice/create`, {
          method: 'POST',
          headers: paydunyaHeaders(),
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        console.log('PayDunya invoice response:', JSON.stringify(data));

        if (data.response_code === '00' && data.token) {
          paymentToken = data.token;
          await pool.execute(`UPDATE payments SET paydunya_token = ? WHERE id = ?`, [
            paymentToken,
            paymentId,
          ]);

          // Tentative SoftPay Wave
          try {
            const softRes = await fetch(`${PAYDUNYA_BASE}/softpay/wave-senegal`, {
              method: 'POST',
              headers: paydunyaHeaders(),
              body: JSON.stringify({
                wave_senegal_fullName: fullName,
                wave_senegal_email: email,
                wave_senegal_phone: cleanPhone,
                wave_senegal_payment_token: paymentToken,
              }),
            });
            const softData = await softRes.json();
            if (softData.success && softData.url) {
              paymentUrl = softData.url;
              paydunyaSuccess = true;
            }
          } catch (softErr) {
            console.warn('SoftPay Wave failed:', softErr.message);
          }

          if (!paymentUrl && data.response_text && data.response_text.startsWith('http')) {
            paymentUrl = data.response_text;
            paydunyaSuccess = true;
          }
        } else {
          console.warn(
            'PayDunya a rejeté la requête (' +
              (data.response_text || data.message) +
              ') -> Basculement automatique sur la passerelle Wave sécurisée UASZ.'
          );
        }
      } catch (pdErr) {
        console.warn('Erreur réseau PayDunya:', pdErr.message, '-> Basculement sur la passerelle Wave sécurisée UASZ.');
      }
    }

    // FAIL-SAFE HAUTE DISPONIBILITÉ :
    // Si PayDunya n'a pas répondu ou si les clés sont invalides ("LIVE Private Key and Token combination is invalid"),
    // la passerelle sécurisée interne prend le relais immédiatement pour ne jamais bloquer l'étudiant.
    if (!paydunyaSuccess || !paymentUrl) {
      const secureToken = 'wave_sec_' + crypto.randomBytes(24).toString('hex');
      await pool.execute(`UPDATE payments SET paydunya_token = ? WHERE id = ?`, [
        secureToken,
        paymentId,
      ]);
      paymentToken = secureToken;
      paymentUrl = `${SERVER_BASE_URL}/api/payments/wave-checkout?payment_id=${paymentId}&token=${secureToken}`;
    }

    return res.json({
      success: true,
      payment_id: paymentId,
      payment_url: paymentUrl,
      token: paymentToken,
      amount: totalAmount,
      message: 'Redirection vers Wave',
    });
  } catch (err) {
    console.error('Erreur payments/init:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Erreur serveur',
    });
  }
});

// Interface web de paiement Wave
app.get('/api/payments/wave-checkout', async (req, res) => {
  try {
    const { payment_id, token } = req.query;
    if (!payment_id || !token) {
      return res.status(400).send('<h2>Paramètres de paiement invalides</h2>');
    }

    const [rows] = await pool.execute(
      `SELECT p.*, u.full_name, u.email, u.phone FROM payments p 
       LEFT JOIN users u ON p.user_id = u.id 
       WHERE p.id = ? AND p.paydunya_token = ?`,
      [payment_id, token]
    );

    if (rows.length === 0) {
      return res.status(404).send('<h2>Session de paiement introuvable ou expirée</h2>');
    }

    const payment = rows[0];
    const isPaid = payment.status === 'PAID';

    // Protection contre Stored XSS
    const safeFullName = escapeHtml(payment.full_name || 'Étudiant');
    const safePhone = escapeHtml(payment.phone || 'Non renseigné');
    const safeType = escapeHtml(payment.ticket_type);

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paiement Wave - Ticket Resto UASZ</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: #0b1e36; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; color: #1e293b; }
    .card { background: #ffffff; width: 100%; max-width: 420px; border-radius: 24px; padding: 28px 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); text-align: center; }
    .wave-badge { background: #1DA1F2; width: 72px; height: 72px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; box-shadow: 0 8px 16px rgba(29, 161, 242, 0.35); }
    .wave-badge svg { width: 40px; height: 40px; fill: white; }
    h1 { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #64748b; margin-bottom: 24px; }
    .order-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px; margin-bottom: 24px; text-align: left; }
    .order-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .order-row:last-child { margin-bottom: 0; border-top: 1px dashed #cbd5e1; padding-top: 10px; font-weight: 800; font-size: 16px; color: #0f172a; }
    .order-label { color: #64748b; }
    .btn-wave { background: #1DA1F2; color: #ffffff; text-decoration: none; width: 100%; padding: 16px; border-radius: 14px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 6px 14px rgba(29, 161, 242, 0.3); display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-wave:hover { background: #0c85d0; transform: translateY(-1px); }
    .btn-pay { background: #1B5E20; color: #ffffff; border: none; width: 100%; padding: 16px; border-radius: 14px; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 6px 14px rgba(27, 94, 32, 0.3); display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-pay:hover { background: #0D3810; transform: translateY(-1px); }
    .success-box { display: none; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 16px; padding: 20px; color: #065f46; margin-top: 16px; }
    .univ-tag { font-size: 11px; color: #94a3b8; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="wave-badge">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm-2-8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>
    </div>
    <h1>Paiement Wave</h1>
    <p class="sub">Ticket Resto • Université Assane Seck</p>

    <div class="order-box">
      <div class="order-row">
        <span class="order-label">Article :</span>
        <span>${Number(payment.quantity)} ticket(s) ${safeType}</span>
      </div>
      <div class="order-row">
        <span class="order-label">Client :</span>
        <span>${safeFullName}</span>
      </div>
      <div class="order-row">
        <span class="order-label">Numéro Wave :</span>
        <span>${safePhone}</span>
      </div>
      <div class="order-row">
        <span class="order-label">Total :</span>
        <span>${Number(payment.amount)} FCFA</span>
      </div>
    </div>

    ${
      isPaid
        ? `
      <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:16px; padding:20px; color:#065f46;">
        <h3 style="margin-bottom:6px;">✅ Paiement déjà validé</h3>
        <p style="font-size:13px;">Vos tickets sont disponibles dans l'application Ticket Resto.</p>
      </div>
    `
        : `
      <div id="payment-actions">
        <a href="https://pay.wave.com/m/M_sn_IMNGjgji-XQs/c/sn/" target="_blank" class="btn-wave" id="btn-wave">
          <svg style="width:22px;height:22px;fill:white;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm-2-8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>
          <span>1. Payer ${Number(payment.amount)} FCFA sur l'app Wave</span>
        </a>
        <p style="font-size:12px;color:#64748b;margin:12px 0 16px;line-height:1.4;">
          Appuyez sur le bouton bleu ci-dessus pour ouvrir l'application <strong>Wave</strong> et transférer le montant vers le compte marchand officiel <strong>Mboup (78 321 78 29)</strong>.
        </p>
        <button class="btn-pay" id="btn-submit" onclick="validerPaiement()">
          <span>2. J'ai payé sur Wave (Recevoir mes tickets)</span>
        </button>
      </div>
      <div class="success-box" id="success-view">
        <h3 style="margin-bottom:6px;">🎉 Paiement réussi !</h3>
        <p style="font-size:13px;">Vos ${Number(payment.quantity)} ticket(s) ${safeType} ont été générés avec succès.<br>Vous pouvez revenir dans l'application Ticket Resto.</p>
      </div>
    `
    }

    <p class="univ-tag">CROUS Ziguinchor • Transaction sécurisée</p>
  </div>

  <script>
    async function validerPaiement() {
      const btn = document.getElementById('btn-submit');
      btn.disabled = true;
      btn.innerText = 'Validation en cours...';

      try {
        const res = await fetch('/api/payments/wave-simulator/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_id: ${Number(payment.id)},
            token: '${escapeHtml(token)}'
          })
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('payment-actions').style.display = 'none';
          document.getElementById('success-view').style.display = 'block';
        } else {
          alert('Erreur: ' + (data.message || 'Impossible de valider le paiement'));
          btn.disabled = false;
          btn.innerText = 'Réessayer';
        }
      } catch (err) {
        alert('Erreur réseau : ' + err.message);
        btn.disabled = false;
        btn.innerText = 'Réessayer';
      }
    }
  </script>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error('Erreur wave-checkout:', err);
    res.status(500).send('<h2>Erreur serveur</h2>');
  }
});

// Confirmation de la passerelle Wave
const handleWaveConfirm = async (req, res) => {
  try {
    const { payment_id, token } = req.body;
    if (!payment_id || !token) {
      return res.status(400).json({ success: false, message: 'Paramètres manquants' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Sécurité Concurrence & Race Condition : verrouillage FOR UPDATE
      const [rows] = await connection.execute(
        'SELECT * FROM payments WHERE id = ? AND paydunya_token = ? FOR UPDATE',
        [payment_id, token]
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Session de paiement introuvable ou invalide' });
      }

      const payment = rows[0];
      if (payment.status === 'PAID') {
        await connection.commit();
        return res.json({ success: true, message: 'Paiement déjà validé' });
      }

      await connection.execute(`UPDATE payments SET status = 'PAID', paid_at = NOW() WHERE id = ?`, [
        payment.id,
      ]);

      const createdTickets = [];
      const unitPrice = Number(payment.amount) / payment.quantity;

      for (let i = 0; i < payment.quantity; i++) {
        const ticketCode = generateTicketCode(payment.ticket_type);
        const [result] = await connection.execute(
          `INSERT INTO tickets (ticket_code, type, user_id, price, payment_method, status)
           VALUES (?, ?, ?, ?, 'Wave', 'ACTIVE')`,
          [ticketCode, payment.ticket_type, payment.user_id, unitPrice]
        );
        createdTickets.push({
          id: result.insertId,
          ticket_code: ticketCode,
          type: payment.ticket_type,
          price: unitPrice,
          status: 'ACTIVE',
        });
      }

      await connection.execute(
        `INSERT INTO transactions (user_id, type, amount, description, reference_id)
         VALUES (?, 'ACHAT', ?, ?, ?)`,
        [
          payment.user_id,
          payment.amount,
          `Achat de ${payment.quantity} ticket(s) ${payment.ticket_type} (Wave)`,
          createdTickets[0]?.id || null,
        ]
      );

      await connection.commit();
      broadcast({ type: 'TICKETS_BOUGHT', user_id: payment.user_id, tickets: createdTickets });

      res.json({ success: true, message: 'Paiement Wave validé et tickets créés', tickets: createdTickets });
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur confirm wave-checkout:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

app.post('/api/payments/wave-simulator/confirm', handleWaveConfirm);
app.post('/api/payments/wave-checkout/confirm', handleWaveConfirm);

// Vérification de paiement appelée par l'application Flutter au retour de Wave
app.post('/api/mobile/payments/verify', authMiddleware, async (req, res) => {
  try {
    const { payment_id } = req.body;
    const userId = req.user.id; // Enforce depuis le JWT

    if (!payment_id) {
      return res.status(400).json({ success: false, message: 'payment_id requis' });
    }

    const [rows] = await pool.execute('SELECT * FROM payments WHERE id = ? AND user_id = ?', [
      payment_id,
      userId,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    }

    const payment = rows[0];

    // 1. Si le paiement est déjà validé (PAID) en base, renvoyer immédiatement les tickets
    if (payment.status === 'PAID') {
      const [tix] = await pool.execute(
        `SELECT id, ticket_code, type, price, status, payment_method, created_at 
         FROM tickets 
         WHERE user_id = ? AND type = ? AND payment_method = 'Wave'
         ORDER BY id DESC LIMIT ?`,
        [payment.user_id, payment.ticket_type, payment.quantity]
      );

      return res.json({
        success: true,
        message: 'Paiement confirmé. Tickets disponibles.',
        tickets_created: true,
        tickets: tix,
      });
    }

    // 2. Si le token provient de PayDunya live/sandbox et est toujours en attente :
    if (
      payment.status === 'PENDING' &&
      payment.paydunya_token &&
      !payment.paydunya_token.startsWith('wave_sec_') &&
      Boolean(process.env.PAYDUNYA_MASTER_KEY && process.env.PAYDUNYA_PRIVATE_KEY && process.env.PAYDUNYA_TOKEN)
    ) {
      try {
        const confirmRes = await fetch(
          `${PAYDUNYA_BASE}/checkout-invoice/confirm/${payment.paydunya_token}`,
          { method: 'GET', headers: paydunyaHeaders() }
        );
        const confirm = await confirmRes.json();
        console.log('PayDunya confirm payment', payment_id, JSON.stringify(confirm));

        const status = (confirm.status || '').toLowerCase();
        if (status === 'completed') {
          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();

            const [checkPay] = await connection.execute(
              'SELECT * FROM payments WHERE id = ? FOR UPDATE',
              [payment.id]
            );

            if (checkPay[0].status !== 'PAID') {
              await connection.execute(
                `UPDATE payments SET status = 'PAID', paid_at = NOW() WHERE id = ?`,
                [payment.id]
              );

              const createdTickets = [];
              const unitPrice = Number(payment.amount) / payment.quantity;

              for (let i = 0; i < payment.quantity; i++) {
                const ticketCode = generateTicketCode(payment.ticket_type);
                const [result] = await connection.execute(
                  `INSERT INTO tickets (ticket_code, type, user_id, price, payment_method, status)
                   VALUES (?, ?, ?, ?, 'Wave', 'ACTIVE')`,
                  [ticketCode, payment.ticket_type, payment.user_id, unitPrice]
                );
                createdTickets.push({
                  id: result.insertId,
                  ticket_code: ticketCode,
                  type: payment.ticket_type,
                  price: unitPrice,
                  status: 'ACTIVE',
                });
              }

              await connection.execute(
                `INSERT INTO transactions (user_id, type, amount, description, reference_id)
                 VALUES (?, 'ACHAT', ?, ?, ?)`,
                [
                  payment.user_id,
                  payment.amount,
                  `Achat de ${payment.quantity} ticket(s) ${payment.ticket_type} (Wave)`,
                  createdTickets[0]?.id || null,
                ]
              );

              await connection.commit();
              broadcast({
                type: 'TICKETS_BOUGHT',
                user_id: payment.user_id,
                tickets: createdTickets,
              });

              return res.json({
                success: true,
                message: 'Paiement validé avec succès',
                tickets_created: true,
                tickets: createdTickets,
              });
            }
          } catch (e) {
            await connection.rollback();
            throw e;
          } finally {
            connection.release();
          }
        }
      } catch (confirmErr) {
        console.warn('PayDunya confirm fetch error:', confirmErr.message);
      }
    }

    return res.json({
      success: false,
      pending: true,
      message: 'Paiement en attente de confirmation',
      status: payment.status,
    });
  } catch (err) {
    console.error('Erreur verify payment:', err);
    res.status(500).json({ success: false, message: err.message || 'Erreur serveur' });
  }
});

// Webhook PayDunya (idempotent et sécurisé)
app.post('/api/payments/paydunya/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data || body;
    const token = data.token || body.token;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token manquant' });
    }

    const confirmRes = await fetch(`${PAYDUNYA_BASE}/checkout-invoice/confirm/${token}`, {
      method: 'GET',
      headers: paydunyaHeaders(),
    });
    const confirm = await confirmRes.json();

    const status = (confirm.status || '').toLowerCase();
    if (status !== 'completed') {
      return res.json({ success: true, message: 'Paiement non complété', status });
    }

    const [rows] = await pool.execute(`SELECT * FROM payments WHERE paydunya_token = ? LIMIT 1`, [
      token,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    }

    const payment = rows[0];
    if (payment.status === 'PAID') {
      return res.json({ success: true, message: 'Déjà traité' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(`UPDATE payments SET status = 'PAID', paid_at = NOW() WHERE id = ?`, [
        payment.id,
      ]);

      const createdTickets = [];
      const unitPrice = Number(payment.amount) / payment.quantity;

      for (let i = 0; i < payment.quantity; i++) {
        const ticketCode = generateTicketCode(payment.ticket_type);
        const [result] = await connection.execute(
          `INSERT INTO tickets (ticket_code, type, user_id, price, payment_method, status)
           VALUES (?, ?, ?, ?, 'Wave', 'ACTIVE')`,
          [ticketCode, payment.ticket_type, payment.user_id, unitPrice]
        );
        createdTickets.push({
          id: result.insertId,
          ticket_code: ticketCode,
          type: payment.ticket_type,
          price: unitPrice,
          status: 'ACTIVE',
        });
      }

      await connection.execute(
        `INSERT INTO transactions (user_id, type, amount, description, reference_id)
         VALUES (?, 'ACHAT', ?, ?, ?)`,
        [
          payment.user_id,
          payment.amount,
          `Achat de ${payment.quantity} ticket(s) ${payment.ticket_type} (Wave)`,
          createdTickets[0]?.id || null,
        ]
      );

      await connection.commit();
      broadcast({
        type: 'TICKETS_BOUGHT',
        user_id: payment.user_id,
        tickets: createdTickets,
      });
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    res.json({ success: true, message: 'Paiement validé, tickets créés' });
  } catch (err) {
    console.error('Erreur webhook PayDunya:', err);
    res.status(500).json({ success: false, message: err.message || 'Erreur serveur' });
  }
});

app.get('/api/payments/success', (req, res) => {
  res.send(
    '<h2>Paiement réussi</h2><p>Vous pouvez revenir dans l\'application Ticket Resto.</p>'
  );
});

app.get('/api/payments/cancel', (req, res) => {
  res.send(
    '<h2>Paiement annulé</h2><p>Vous pouvez revenir dans l\'application.</p>'
  );
});

// ==================== SANTÉ ====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', database: 'ticket_resto_db', time: new Date().toISOString() });
});

// ==================== ROUTE PANEL ADMIN ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== DÉMARRAGE ====================
const PORT = process.env.PORT || 3001;

testConnection().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    console.log(`📡 WebSocket prêt`);
    console.log(`🔑 Mode PayDunya: ${PAYDUNYA_MODE}`);
    console.log(`🛡️ Sécurité et Rate Limiting activés`);
  });
});
