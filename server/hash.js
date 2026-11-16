// Usage: node hash.js 'MonMotDePasse'  → prints the APP_PASSWORD_HASH line for .env
const bcrypt = require("bcryptjs");
const pwd = process.argv[2];
if (!pwd) { console.error("Usage: node hash.js 'MonMotDePasse'"); process.exit(1); }
// single quotes keep the "$" characters literal in docker compose .env files
console.log(`APP_PASSWORD_HASH='${bcrypt.hashSync(pwd, 12)}'`);
