require('dotenv').config();
const nodemailer = require('nodemailer');

async function test() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: (process.env.SMTP_PASS || '').replace(/\s/g, ''),
    },
    tls: { rejectUnauthorized: false },
  });

  try {
    await transporter.verify();
    console.log('✅ Connexion SMTP OK');

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.SMTP_USER, // envoi à toi-même
      subject: 'Test Ticket Resto',
      text: 'Si tu reçois ce message, SMTP fonctionne.',
    });
    console.log('✅ Email de test envoyé');
  } catch (e) {
    console.error('❌ Erreur:', e.message);
  }
}

test();