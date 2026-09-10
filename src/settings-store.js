const fs = require('node:fs');
const path = require('node:path');

class SettingsStore {
  constructor(directory, safeStorage) { this.file = path.join(directory, 'bot-settings.json'); this.safeStorage = safeStorage; }
  read() {
    if (!fs.existsSync(this.file)) return null;
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable. Your saved bot token cannot be opened.');
    return { ownerId: data.ownerId, token: this.safeStorage.decryptString(Buffer.from(data.encryptedToken, 'base64')) };
  }
  write(settings) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable. The bot token was not saved.');
    const data = { version: 1, ownerId: settings.ownerId, encryptedToken: this.safeStorage.encryptString(settings.token).toString('base64') };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  clear() { fs.rmSync(this.file, { force: true }); }
}
module.exports = { SettingsStore };
