const bcrypt = require('bcryptjs');

async function generate() {
  const passwords = {
    admin: 'admin123',
    agent: 'agent123',
    etudiant: 'etudiant123'
  };

  for (const [role, pwd] of Object.entries(passwords)) {
    const hash = await bcrypt.hash(pwd, 10);
    console.log(`${role} (${pwd}) → ${hash}`);
  }
}

generate();