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
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ticket_resto_db',
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

app.post('/api/mobile/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
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

    const { password: _, ...userWithoutPassword } = user;
    const token = signToken(userWithoutPassword);

    res.json({
      success: true,
      message: 'Connexion réussie',
      user: userWithoutPassword,
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
    const { full_name, email, password, user_type, student_id } = req.body;

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
      user_type,
      student_id: student_id || null,
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
      `INSERT INTO users (full_name, email, password, user_type, student_id) VALUES (?, ?, ?, ?, ?)`,
      [stored.full_name, email, hashedPassword, stored.user_type, stored.student_id]
    );

    const newUser = {
      id: result.insertId,
      full_name: stored.full_name,
      email,
      user_type: stored.user_type,
      student_id: stored.student_id,
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
app.post('/api/mobile/register', async (req, res) => {
  try {
    const { full_name, email, password, user_type, student_id } = req.body;

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
      `INSERT INTO users (full_name, email, password, user_type, student_id) VALUES (?, ?, ?, ?, ?)`,
      [full_name, email, hashedPassword, user_type, student_id || null]
    );

    const newUser = {
      id: result.insertId,
      full_name,
      email,
      user_type,
      student_id: student_id || null,
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

app.post('/api/mobile/tickets/buy', authMiddleware, async (req, res) => {
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
    const { from_user_id, to_user_id, ticket_id } = req.body;

    if (!from_user_id || !to_user_id || !ticket_id) {
      return res.status(400).json({ success: false, message: 'Données manquantes' });
    }

    if (from_user_id === to_user_id) {
      return res.status(400).json({ success: false, message: 'Impossible de se transférer à soi-même' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [tickets] = await connection.execute(
        'SELECT * FROM tickets WHERE id = ? AND user_id = ? AND status = "ACTIVE"',
        [ticket_id, from_user_id]
      );

      if (tickets.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Ticket introuvable ou non transferable' });
      }

      const [users] = await connection.execute(
        'SELECT id FROM users WHERE id = ? AND is_active = 1',
        [to_user_id]
      );

      if (users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Destinataire introuvable' });
      }

      await connection.execute(
        `UPDATE tickets SET user_id = ?, status = 'TRANSFERRED' WHERE id = ?`,
        [to_user_id, ticket_id]
      );

      await connection.execute(
        `INSERT INTO transfers (from_user_id, to_user_id, ticket_id) VALUES (?, ?, ?)`,
        [from_user_id, to_user_id, ticket_id]
      );

      await connection.execute(
        `INSERT INTO transactions (user_id, type, amount, description, reference_id)
         VALUES (?, 'TRANSFERT', 0, ?, ?)`,
        [from_user_id, `Transfert du ticket #${ticket_id} vers utilisateur ${to_user_id}`, ticket_id]
      );

      await connection.commit();

      broadcast({
        type: 'TICKET_TRANSFERRED',
        ticket_id,
        from_user_id,
        to_user_id
      });

      res.json({
        success: true,
        message: 'Ticket transféré avec succès'
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur transfer:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ==================== REMBOURSEMENT ====================

app.post('/api/mobile/tickets/refund', authMiddleware, async (req, res) => {
  try {
    const { user_id, ticket_id, payment_method } = req.body;

    if (!user_id || !ticket_id || !payment_method) {
      return res.status(400).json({ success: false, message: 'Données manquantes' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [tickets] = await connection.execute(
        'SELECT * FROM tickets WHERE id = ? AND user_id = ? AND status = "ACTIVE"',
        [ticket_id, user_id]
      );

      if (tickets.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Ticket introuvable ou non remboursable' });
      }

      const ticket = tickets[0];

      await connection.execute(
        `UPDATE tickets SET status = 'REFUNDED' WHERE id = ?`,
        [ticket_id]
      );

      const [result] = await connection.execute(
        `INSERT INTO refunds (user_id, ticket_id, amount, payment_method, status)
         VALUES (?, ?, ?, ?, 'PENDING')`,
        [user_id, ticket_id, ticket.price, payment_method]
      );

      await connection.execute(
        `INSERT INTO transactions (user_id, type, amount, description, reference_id)
         VALUES (?, 'REMBOURSEMENT', ?, ?, ?)`,
        [user_id, ticket.price, `Demande de remboursement ticket #${ticket_id}`, result.insertId]
      );

      await connection.commit();

      broadcast({
        type: 'REFUND_REQUESTED',
        user_id,
        ticket_id,
        amount: ticket.price
      });

      res.json({
        success: true,
        message: 'Demande de remboursement enregistrée',
        refund_id: result.insertId
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erreur refund:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
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