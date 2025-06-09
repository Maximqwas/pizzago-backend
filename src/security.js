const argon2 = require('argon2');
const crypto = require('crypto');

function hashPassword(password) {
    return argon2.hash(password, { type: argon2.argon2id });
}

function verifyPassword(password, hash) {
    return argon2.verify(hash, password);
}

function getSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    hashPassword,
    verifyPassword,
    getSecureToken
};