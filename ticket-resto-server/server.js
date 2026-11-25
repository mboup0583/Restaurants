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
 
const JWT_SECRET = process.env.JWT_SECRET || 'ticket_resto_secret_2026_change_me';
 
// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
 
// Middleware d'authentification
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, user_type }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
  }
}
 

// ==================== SÉCURITÉ : RATE LIMITING ====================
const rateLimitStore = new Map();

function createRateLimiter({ windowMs = 15 * 60 * 1000, maxRequests = 10, message } = {}) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
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

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.user_type !== 'Administrateur') {
    return res.status(403).json({ success: false, message: 'Accès admin requis' });
  }
  next();
}
 
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
  queueLimit: 0
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
 
// ==================== STOCKAGE TEMPORAIRE DES CODES ====================
const verificationCodes = new Map();
 
function generateVerificationCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}
 
async function sendVerificationEmail(email, code, fullName) {
  try {
    await transporter.verify();
 
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <div style="text-align: center; background-color: #ff6b00; padding: 20px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Ticket Resto</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Bonjour ${fullName},</h2>
          <p>Vous venez de créer un compte sur l'application Ticket Resto.</p>
          <p>Pour finaliser votre inscription, veuillez utiliser le code de vérification ci-dessous :</p>
          <div style="text-align: center; margin: 30px 0;">
            <div style="display: inline-block; background-color: #f5f5f5; padding: 15px 30px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ff6b00;">
              ${code}
            </div>
          </div>
          <p>Ce code est valable pendant 15 minutes.</p>
          <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
          <p style="color: #888; font-size: 12px; text-align: center;">
            © 2026 Ticket Resto - Tous droits réservés
          </p>
        </div>
      </div>
    `;
 
    await transporter.sendMail({
      from: `"Ticket Resto" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Vérification de votre compte Ticket Resto',
      html,
    });
 
    console.log(`✅ Email envoyé à ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Erreur SMTP:', error.message);
    return false;
  }
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
 
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, password, user_type, student_id, phone, is_active, created_at, updated_at
       FROM users WHERE email = ? AND is_active = 1`,
      [email]
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
app.post('/api/mobile/send-verification-code', async (req, res) => {
  try {
    const { full_name, email, password, user_type, student_id, phone } = req.body;
 
    if (!full_name || !email || !password || !user_type) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
 
    const allowedTypes = ['Administrateur', 'Agent universitaire', 'Étudiant'];
    if (!allowedTypes.includes(user_type)) {
      return res.status(400).json({ success: false, message: 'Type d\'utilisateur invalide' });
    }
 
    if (user_type === 'Étudiant' && !student_id) {
      return res.status(400).json({ success: false, message: 'Numéro étudiant obligatoire' });
    }
 
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    }
 
    const code = generateVerificationCode();
 
    verificationCodes.set(email, {
      full_name,
      password,
      user_type: safeUserType,
      student_id: student_id || null,
      phone: phone ? String(phone).replace(/\s/g, '') : null,
      code,
      expires: Date.now() + 15 * 60 * 1000,
    });
 
    let emailSent = false;
    let mailError = null;
 
    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        await transporter.verify();
 
        await transporter.sendMail({
          from: `"Ticket Resto" <${process.env.SMTP_USER}>`,
          to: email,
          subject: 'Code de vérification - Ticket Resto',
          text: `Bonjour ${full_name},\n\nVotre code de vérification est : ${code}\n\nIl expire dans 10 minutes.\n\nTicket Resto`,
          html: `
            <h2>Ticket Resto</h2>
            <p>Bonjour <strong>${full_name}</strong>,</p>
            <p>Votre code de vérification est :</p>
            <h1 style="letter-spacing:8px;color:#e65100;">${code}</h1>
            <p>Il expire dans 10 minutes.</p>
          `,
        });
 
        emailSent = true;
        console.log(`✅ Email envoyé à ${email}`);
      } else {
        mailError = 'SMTP_USER ou SMTP_PASS manquant dans .env';
      }
    } catch (mailErr) {
      mailError = mailErr.message;
      console.error('❌ Erreur SMTP:', mailErr.message);
    }
 
    console.log(`\n📧 Code de vérification pour ${email} : ${code}\n`);
 
    res.json({
      success: true,
      message: emailSent
        ? 'Code envoyé par email'
        : `Code généré (email non envoyé: ${mailError || 'config SMTP'}). Voir console serveur.`,
      debug_code: code,
    });
  } catch (err) {
    console.error('Erreur send verification code:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});
 
// ==================== VÉRIFIER CODE + CRÉER COMPTE ====================
app.post('/api/mobile/verify-and-register', async (req, res) => {
  try {
    const { email, code } = req.body;
 
    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email et code requis' });
    }
 
    const stored = verificationCodes.get(email);
 
    if (!stored) {
      return res.status(400).json({ success: false, message: 'Aucune demande de vérification en cours' });
    }
 
    if (stored.code !== code) {
      return res.status(400).json({ success: false, message: 'Code incorrect' });
    }
 
    if (Date.now() > stored.expires) {
      verificationCodes.delete(email);
      return res.status(400).json({ success: false, message: 'Le code a expiré. Veuillez réessayer.' });
    }
 
    const hashedPassword = await bcrypt.hash(stored.password, 10);
 
    const [result] = await pool.execute(
      `INSERT INTO users (full_name, email, password, user_type, student_id, phone) VALUES (?, ?, ?, ?, ?, ?)`,
      [stored.full_name, email, hashedPassword, stored.user_type, stored.student_id, stored.phone]
    );
 
    const newUser = {
      id: result.insertId,
      full_name: stored.full_name,
      email,
      user_type: stored.user_type,
      student_id: stored.student_id,
      phone: stored.phone,
      is_active: 1
    };
 
    const token = signToken(newUser);
 
    broadcast({ type: 'USER_ADDED', user: newUser });
 
    verificationCodes.delete(email);
 
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
 
// ==================== ROUTE REGISTER (ANCIENNE - GARDÉE POUR COMPATIBILITÉ) ====================
app.post('/api/mobile/register', otpLimiter, async (req, res) => {
  try {
    const { full_name, email, password, user_type, student_id, phone } = req.body;
 
    if (!full_name || !email || !password || !user_type) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }
 
    const allowedTypes = ['Administrateur', 'Agent universitaire', 'Étudiant'];
    if (!allowedTypes.includes(user_type)) {
      return res.status(400).json({ success: false, message: 'Type d\'utilisateur invalide' });
    }
 
    if (user_type === 'Étudiant' && !student_id) {
      return res.status(400).json({ success: false, message: 'Numéro étudiant obligatoire' });
    }
 
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    }
 
    const hashedPassword = await bcrypt.hash(password, 10);
 
    const [result] = await pool.execute(
      `INSERT INTO users (full_name, email, password, user_type, student_id, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        full_name,
        email,
        hashedPassword,
        safeUserType,
        student_id || null,
        phone ? String(phone).replace(/\s/g, '') : null,
      ]
    );
 
    const newUser = {
      id: result.insertId,
      full_name,
      email,
      user_type,
      student_id: student_id || null,
      phone: phone ? String(phone).replace(/\s/g, '') : null,
      is_active: 1
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
 
app.get('/api/mobile/users', authMiddleware, async (req, res) => {
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
 
// ==================== ROUTES TICKETS ====================
 
// Achat direct / allocation manuelle : réservée aux Administrateurs (les étudiants passent par Wave/PayDunya)
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
 
    // Récupérer les prix depuis la table settings
    const [priceRows] = await pool.execute(
      `SELECT setting_key, setting_value FROM settings
       WHERE setting_key IN ('price_petit_dejeuner', 'price_repas')`
    );
    const priceMap = {};
    priceRows.forEach((r) => { priceMap[r.setting_key] = parseInt(r.setting_value, 10); });
    const price = type === 'Petit-déjeuner'
      ? (priceMap.price_petit_dejeuner || 50)
      : (priceMap.price_repas || 100);
 
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
          status: 'ACTIVE'
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
        tickets: createdTickets
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
 
app.get('/api/mobile/tickets/my/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    const [rows] = await pool.execute(
      `SELECT id, ticket_code, type, price, status, payment_method, created_at, used_at
       FROM tickets WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ success: true, tickets: rows });
  } catch (err) {
    console.error('Erreur get my tickets:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});
 
app.post('/api/mobile/tickets/validate', authMiddleware, async (req, res) => {
  try {
    const { ticket_code, agent_id } = req.body;
 
    if (!ticket_code || !agent_id) {
      return res.status(400).json({ success: false, message: 'ticket_code et agent_id requis' });
    }
 
    const [rows] = await pool.execute('SELECT * FROM tickets WHERE ticket_code = ?', [ticket_code]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket introuvable' });
    }
 
    const ticket = rows[0];
    if (ticket.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: `Ticket déjà ${ticket.status.toLowerCase()}` });
    }
 
    await pool.execute(
      `UPDATE tickets SET status = 'USED', used_at = NOW(), used_by_agent = ? WHERE id = ?`,
      [agent_id, ticket.id]
    );
 
    await pool.execute(
      `INSERT INTO transactions (user_id, type, amount, description, reference_id)
       VALUES (?, 'UTILISATION', 0, ?, ?)`,
      [ticket.user_id, `Ticket ${ticket.type} utilisé`, ticket.id]
    );
 
    broadcast({ type: 'TICKET_USED', ticket_code, user_id: ticket.user_id, agent_id });
 
    res.json({
      success: true,
      message: 'Ticket validé avec succès',
      ticket: { id: ticket.id, ticket_code: ticket.ticket_code, type: ticket.type, status: 'USED' }
    });
  } catch (err) {
    console.error('Erreur validate ticket:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});
 
// ==================== TRANSFERT ====================
 
app.post('/api/mobile/tickets/transfer', authMiddleware, async (req, res) => {
  try {
    const { from_user_id, to_user_id, ticket_id, ticket_ids } = req.body;

    let targetTicketIds = [];
    if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
      targetTicketIds = ticket_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    } else if (ticket_id) {
      targetTicketIds = [parseInt(ticket_id, 10)];
    }

    if (!from_user_id || !to_user_id || targetTicketIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Données manquantes ou aucun ticket sélectionné' });
    }

    if (parseInt(from_user_id, 10) === parseInt(to_user_id, 10)) {
      return res.status(400).json({ success: false, message: 'Impossible de se transférer à soi-même' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [users] = await connection.execute(
        'SELECT id, full_name, email FROM users WHERE id = ? AND is_active = 1',
        [to_user_id]
      );

      if (users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Destinataire introuvable ou inactif' });
      }

      const placeholders = targetTicketIds.map(() => '?').join(',');
      const [tickets] = await connection.query(
        `SELECT id, ticket_code, type, price FROM tickets WHERE id IN (${placeholders}) AND user_id = ? AND status = 'ACTIVE'`,
        [...targetTicketIds, from_user_id]
      );

      if (tickets.length !== targetTicketIds.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Un ou plusieurs tickets sont introuvables ou ne peuvent plus être transférés'
        });
      }

      // Mettre à jour les tickets vers le destinataire en statut ACTIVE
      await connection.query(
        `UPDATE tickets SET user_id = ?, status = 'ACTIVE' WHERE id IN (${placeholders})`,
        [to_user_id, ...targetTicketIds]
      );

      for (const t of tickets) {
        await connection.execute(
          `INSERT INTO transfers (from_user_id, to_user_id, ticket_id) VALUES (?, ?, ?)`,
          [from_user_id, to_user_id, t.id]
        );

        await connection.execute(
          `INSERT INTO transactions (user_id, type, amount, description, reference_id)
           VALUES (?, 'TRANSFERT', 0, ?, ?)`,
          [from_user_id, `Transfert du ticket #${t.id} (${t.type}) vers utilisateur ${to_user_id}`, t.id]
        );
      }

      await connection.commit();

      broadcast({
        type: 'TICKETS_TRANSFERRED',
        ticket_ids: targetTicketIds,
        from_user_id,
        to_user_id,
        count: targetTicketIds.length
      });

      const count = targetTicketIds.length;
      res.json({
        success: true,
        message: count === 1 ? 'Ticket transféré avec succès' : `${count} tickets transférés avec succès`
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

// ==================== REMBOURSEMENT ====================
 
app.post('/api/mobile/tickets/refund', authMiddleware, async (req, res) => {
  try {
    const { user_id, payment_method, ticket_id, ticket_ids } = req.body;

    let targetTicketIds = [];
    if (Array.isArray(ticket_ids) && ticket_ids.length > 0) {
      targetTicketIds = ticket_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    } else if (ticket_id) {
      targetTicketIds = [parseInt(ticket_id, 10)];
    }

    if (!user_id || !payment_method || targetTicketIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Données manquantes ou aucun ticket sélectionné' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const placeholders = targetTicketIds.map(() => '?').join(',');
      const [tickets] = await connection.query(
        `SELECT id, ticket_code, type, price FROM tickets WHERE id IN (${placeholders}) AND user_id = ? AND status = 'ACTIVE'`,
        [...targetTicketIds, user_id]
      );

      if (tickets.length !== targetTicketIds.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Un ou plusieurs tickets sont introuvables ou ne peuvent plus être remboursés'
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
        count: targetTicketIds.length
      });

      const count = targetTicketIds.length;
      res.json({
        success: true,
        message: count === 1
          ? 'Demande de remboursement enregistrée'
          : `${count} demandes de remboursement enregistrées (${totalAmount} FCFA)`,
        refund_ids: refundIds,
        total_amount: totalAmount
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
      values.push(full_name);
    }
    if (email !== undefined) {
      const [exist] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, userId]
      );
      if (exist.length > 0) {
        return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
      }
      updates.push('email = ?');
      values.push(email);
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
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
 
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
    const [target] = await pool.execute(
      `SELECT user_type FROM users WHERE id = ?`,
      [userId]
    );
 
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
      [status, processed_by || null, refundId]
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
 
// ==================== ADMIN : PRIX ====================
 
// Prix accessibles aux utilisateurs connectés (mobile)
app.get('/api/mobile/prices', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
    const prices = {};
    rows.forEach((r) => { prices[r.setting_key] = r.setting_value; });
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
 
// ==================== AGENT : RAPPORT VENTES ====================
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
 
// ==================== PAYDUNYA (WAVE + FALLBACK CHECKOUT) ====================
const PAYDUNYA_MODE = process.env.PAYDUNYA_MODE || 'test';
const PAYDUNYA_BASE =
  PAYDUNYA_MODE === 'live'
    ? 'https://app.paydunya.com/api/v1'
    : 'https://app.paydunya.com/sandbox-api/v1';
 
const PAYDUNYA_MIN_AMOUNT = 200;
 
function paydunyaHeaders() {
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_MASTER_KEY || '',
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY || '',
    'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN || '',
  };
}
 
app.post('/api/mobile/payments/init', authMiddleware, async (req, res) => {
  try {
    let { user_id, type, quantity, payment_method, phone } = req.body;
 
    if (!user_id || !type || !quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: 'Données invalides' });
    }
 
    if (payment_method !== 'Wave') {
      return res.status(400).json({
        success: false,
        message: 'Seul Wave est disponible pour le moment. Orange Money bientôt.',
      });
    }
 
    // Si pas de phone dans la requête → prendre celui en base
    if (!phone || String(phone).trim() === '') {
      const [rows] = await pool.execute(
        'SELECT phone FROM users WHERE id = ?',
        [user_id || req.user.id]
      );
      phone = rows[0]?.phone || null;
    }
 
    if (payment_method === 'Wave' && (!phone || String(phone).trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Aucun numéro de téléphone enregistré. Mets à jour ton profil ou réinscris-toi avec ton numéro Wave.',
      });
    }
 
    // nettoyage
    phone = String(phone).replace(/\s/g, '').replace(/^\+221/, '');
 
    const allowedTypes = ['Petit-déjeuner', 'Repas'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Type de ticket invalide' });
    }
 
    // Clés PayDunya présentes ?
    if (
      !process.env.PAYDUNYA_MASTER_KEY ||
      !process.env.PAYDUNYA_PRIVATE_KEY ||
      !process.env.PAYDUNYA_TOKEN
    ) {
      return res.status(500).json({
        success: false,
        message: 'Configuration PayDunya manquante sur le serveur (clés API)',
      });
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
        message:
          'Montant minimum Wave : 200 FCFA. Prenez au moins 2 repas (ou 4 petits-déjeuners).',
      });
    }
 
    const cleanPhone = phone;
 
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
        message: 'Table payments inaccessible: ' + e.message,
      });
    }
 
    const payload = {
      invoice: {
        total_amount: totalAmount,
        description: `Achat ${quantity} ticket(s) ${type} - Ticket Resto #${paymentId}`,
      },
      store: {
        name: 'Ticket Resto',
        tagline: 'Restaurant universitaire',
      },
      custom_data: {
        payment_id: String(paymentId),
        user_id: String(user_id),
        ticket_type: type,
        quantity: String(quantity),
      },
      actions: {
        callback_url: 'https://ticket-resto-api.onrender.com/api/payments/paydunya/webhook',
        cancel_url: 'https://ticket-resto-api.onrender.com/api/payments/cancel',
        return_url: 'https://ticket-resto-api.onrender.com/api/payments/success',
      },
    };
 
    const response = await fetch(`${PAYDUNYA_BASE}/checkout-invoice/create`, {
      method: 'POST',
      headers: paydunyaHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    console.log('PayDunya invoice:', JSON.stringify(data));
 
    if (data.response_code !== '00') {
      await pool.execute(`UPDATE payments SET status = 'FAILED' WHERE id = ?`, [paymentId]);
      return res.status(400).json({
        success: false,
        message: data.response_text || data.message || 'Erreur création facture PayDunya',
      });
    }
 
    await pool.execute(`UPDATE payments SET paydunya_token = ? WHERE id = ?`, [
      data.token,
      paymentId,
    ]);
 
    const fullName =
      (req.user && (req.user.full_name || req.user.fullName)) || 'Client Ticket Resto';
    const email = (req.user && req.user.email) || 'client@ticketresto.sn';
 
    // SoftPay Wave
    let softData = {};
    try {
      const softRes = await fetch(`${PAYDUNYA_BASE}/softpay/wave-senegal`, {
        method: 'POST',
        headers: paydunyaHeaders(),
        body: JSON.stringify({
          wave_senegal_fullName: fullName,
          wave_senegal_email: email,
          wave_senegal_phone: cleanPhone,
          wave_senegal_payment_token: data.token,
        }),
      });
      softData = await softRes.json();
      console.log('SoftPay Wave:', JSON.stringify(softData));
    } catch (e) {
      console.error('SoftPay fetch error:', e.message);
      softData = { success: false, message: e.message };
    }
 
    // SoftPay OK → URL Wave
    if (softData.success && softData.url) {
      return res.json({
        success: true,
        payment_id: paymentId,
        payment_url: softData.url,
        token: data.token,
        amount: totalAmount,
        message: softData.message || 'Redirection vers Wave',
      });
    }
 
    // Fallback : page checkout PayDunya (choisir Wave)
    const checkoutUrl = data.response_text;
    if (checkoutUrl) {
      return res.json({
        success: true,
        payment_id: paymentId,
        payment_url: checkoutUrl,
        token: data.token,
        amount: totalAmount,
        message:
          softData.message ||
          'Ouvrez la page de paiement et choisissez Wave',
      });
    }
 
    await pool.execute(`UPDATE payments SET status = 'FAILED' WHERE id = ?`, [paymentId]);
    return res.status(400).json({
      success: false,
      message: softData.message || 'Impossible de lancer le paiement Wave',
    });
  } catch (err) {
    console.error('Erreur payments/init:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Erreur serveur',
    });
  }
});

// ==================== VÉRIFIER PAIEMENT (APRÈS RETOUR WAVE) ====================
app.post('/api/mobile/payments/verify', authMiddleware, async (req, res) => {
  try {
    const { payment_id } = req.body;
    const userId = req.user.id;

    if (!payment_id) {
      return res.status(400).json({ success: false, message: 'payment_id requis' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM payments WHERE id = ? AND user_id = ?',
      [payment_id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    }

    const payment = rows[0];

    if (!payment.paydunya_token) {
      return res.status(400).json({ success: false, message: 'Token PayDunya manquant' });
    }

    const confirmRes = await fetch(
      `${PAYDUNYA_BASE}/checkout-invoice/confirm/${payment.paydunya_token}`,
      { method: 'GET', headers: paydunyaHeaders() }
    );
    const confirm = await confirmRes.json();
    console.log('PayDunya confirm payment', payment_id, JSON.stringify(confirm));

    const status = (confirm.status || '').toLowerCase();
    if (status !== 'completed') {
      return res.json({
        success: false,
        pending: true,
        message: 'Paiement pas encore complété',
        status,
      });
    }

    // Anti-doublon : si le paiement est déjà PAID et que les tickets existent, on s'arrête
    if (payment.status === 'PAID') {
      const [tix] = await pool.execute(
        `SELECT id, ticket_code, type, price, status FROM tickets
         WHERE user_id = ? AND type = ? AND payment_method = ?
         ORDER BY id DESC LIMIT ?`,
        [payment.user_id, payment.ticket_type, payment.payment_method, payment.quantity]
      );
      if (tix.length >= payment.quantity) {
        return res.json({
          success: true,
          message: 'Déjà validé',
          tickets_created: true,
          tickets: tix,
        });
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        `UPDATE payments SET status = 'PAID', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?`,
        [payment.id]
      );

      const createdTickets = [];
      const unitPrice = Number(payment.amount) / payment.quantity;

      for (let i = 0; i < payment.quantity; i++) {
        const ticketCode = generateTicketCode(payment.ticket_type);
        const [result] = await connection.execute(
          `INSERT INTO tickets (ticket_code, type, user_id, price, payment_method, status)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
          [
            ticketCode,
            payment.ticket_type,
            payment.user_id,
            unitPrice,
            payment.payment_method,
          ]
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

      res.json({
        success: true,
        message: 'Paiement validé, tickets créés',
        tickets_created: true,
        tickets: createdTickets,
      });
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur verify payment:', err);
    res.status(500).json({ success: false, message: err.message || 'Erreur serveur' });
  }
});

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
 
    const [rows] = await pool.execute(
      `SELECT * FROM payments WHERE paydunya_token = ? LIMIT 1`,
      [token]
    );
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
           VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
          [
            ticketCode,
            payment.ticket_type,
            payment.user_id,
            unitPrice,
            payment.payment_method,
          ]
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
 

// ==================== INTERFACE DE PAIEMENT WAVE SÉNÉGAL ====================
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
      return res.status(404).send('<h2>Paiement introuvable ou expiré</h2>');
    }

    const payment = rows[0];
    const isPaid = payment.status === 'PAID';

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
    .btn-pay { background: #1DA1F2; color: #ffffff; border: none; width: 100%; padding: 16px; border-radius: 14px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 6px 14px rgba(29, 161, 242, 0.3); display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-pay:hover { background: #0c85d0; transform: translateY(-1px); }
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
        <span>${payment.quantity} ticket(s) ${payment.ticket_type}</span>
      </div>
      <div class="order-row">
        <span class="order-label">Client :</span>
        <span>${payment.full_name || 'Étudiant'}</span>
      </div>
      <div class="order-row">
        <span class="order-label">Téléphone :</span>
        <span>${payment.phone || 'Non renseigné'}</span>
      </div>
      <div class="order-row">
        <span class="order-label">Total :</span>
        <span>${payment.amount} FCFA</span>
      </div>
    </div>

    ${isPaid ? `
      <div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:16px; padding:20px; color:#065f46;">
        <h3 style="margin-bottom:6px;">✅ Paiement déjà validé</h3>
        <p style="font-size:13px;">Vos tickets sont disponibles dans l'application Ticket Resto.</p>
      </div>
    ` : `
      <button class="btn-pay" id="btn-submit" onclick="validerPaiement()">
        <span>Payer ${payment.amount} FCFA avec Wave</span>
      </button>
      <div class="success-box" id="success-view">
        <h3 style="margin-bottom:6px;">🎉 Paiement réussi !</h3>
        <p style="font-size:13px;">Vos ${payment.quantity} ticket(s) ${payment.ticket_type} ont été générés.<br>Vous pouvez revenir dans l'application Ticket Resto.</p>
      </div>
    `}

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
            payment_id: ${payment.id},
            token: '${token}'
          })
        });
        const data = await res.json();
        if (data.success) {
          btn.style.display = 'none';
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

// Endpoint de confirmation directe pour la passerelle Wave
app.post('/api/payments/wave-simulator/confirm', async (req, res) => {
  try {
    const { payment_id, token } = req.body;
    if (!payment_id || !token) {
      return res.status(400).json({ success: false, message: 'Paramètres manquants' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Sécurité Race Condition : verrouillage FOR UPDATE
      const [rows] = await connection.execute(
        'SELECT * FROM payments WHERE id = ? AND paydunya_token = ? FOR UPDATE',
        [payment_id, token]
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Paiement introuvable' });
      }

      const payment = rows[0];
      if (payment.status === 'PAID') {
        await connection.commit();
        return res.json({ success: true, message: 'Déjà validé' });
      }

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
      broadcast({ type: 'TICKETS_BOUGHT', user_id: payment.user_id, tickets: createdTickets });

      res.json({ success: true, message: 'Paiement Wave validé et tickets créés', tickets: createdTickets });
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur confirm wave-simulator:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
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
    console.log(`🔑 JWT Secret configuré`);
  });
});