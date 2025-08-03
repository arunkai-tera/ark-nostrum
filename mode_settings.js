// mode_settings.js
const fs = require('fs');
const path = require('path');

const SETTINGS_DIR = path.join(__dirname, 'char_settings');
if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR);

function getCharId(mod) {
    if (!mod.game.me || !mod.game.me.name || !mod.game.me.serverId) return 'default';
    return `${mod.game.me.name}_${mod.game.me.serverId}`;
}

function getFilePath(mod) {
    return path.join(SETTINGS_DIR, `${getCharId(mod)}.json`);
}

function loadModeSettings(mod) {
    try {
        const data = fs.readFileSync(getFilePath(mod), 'utf8');
        return JSON.parse(data);
    } catch {
        return {
            nostrumMode: 'brave',
            foodMode: 'power'
        };
    }
}

function saveModeSettings(mod, settings) {
    try {
        fs.writeFileSync(getFilePath(mod), JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error('[mode_settings] Failed to save settings:', err);
    }
}

module.exports = { loadModeSettings, saveModeSettings };