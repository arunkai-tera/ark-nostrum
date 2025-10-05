const { loadModeSettings, saveModeSettings } = require('./mode_settings');
const SettingsUI = require('tera-mod-ui').Settings;

const BUFFS_Food_STRONGER = [70222, 70231, 70241, 70242];
const BUFF_RES_INVINCIBLE = 1134;
const BUFF_PHOENIX = 6007;

function getItemsNostrum(settings) {
    return settings.nostrumMode === 'brave' ? [999000] : [999001];
}

function getBuffsNostrum(settings) {
    return [settings.nostrumMode === 'brave' ? 900010008 : 900010009];
}

function getItemsFood(settings) {
    return [settings.foodMode === 'power' ? 206015 : 206014];
}

function getBuffsFood(settings) {
    return [settings.foodMode === 'power' ? 70233 : 70232];
}

function ClientMod(mod) {
    this.nostrum = [];
    this.food = [];

    mod.clientInterface.once('ready', async () => {
        const modeSettings = loadModeSettings(mod);
        this.nostrum = (await mod.queryData('/ItemData/Item@id=?/', getItemsNostrum(modeSettings), true, false, ['id', 'requiredLevel'])).map(result => result.attributes);
        this.food = (await mod.queryData('/ItemData/Item@id=?/', getItemsFood(modeSettings), true, false, ['id', 'requiredLevel'])).map(result => result.attributes);
    });
}

function NetworkMod(mod) {
    mod.game.initialize(['me', 'me.abnormalities', 'contract']);

    function abnormalityDuration(id) {
        const abnormality = mod.game.me.abnormalities[id];
        return abnormality ? abnormality.remaining : 0n;
    }

    let modeSettings = null;
    let nostrum_item = null;
    let food_item = null;
    let currentBuffsNostrum = [];
    let currentBuffsFood = [];
    let lastPremiumSets = [];

    function updatePremiumItems() {
        nostrum_item = null;
        food_item = null;

        const validNostrumIds = getItemsNostrum(modeSettings);
        const validFoodIds = getItemsFood(modeSettings);

        lastPremiumSets.forEach(set => {
            set.inventory.filter(entry => entry.type === 1).forEach(entry => {
                const id = entry.id;

                if (validNostrumIds.includes(id)) {
                    const match = mod.clientMod.nostrum.find(item => item.id === id);
                    if (match) {
                        nostrum_item = {
                            data: match,
                            packet: { set: set.id, slot: entry.slot, type: entry.type, id }
                        };
                    }
                } else if (validFoodIds.includes(id)) {
                    const match = mod.clientMod.food.find(item => item.id === id);
                    if (match) {
                        food_item = {
                            data: match,
                            packet: { set: set.id, slot: entry.slot, type: entry.type, id }
                        };
                    }
                }
            });
        });
    }

    mod.hook('S_PREMIUM_SLOT_DATALIST', 2, event => {
        lastPremiumSets = event.sets;
        updatePremiumItems();
    });

    mod.hook('S_PREMIUM_SLOT_OFF', 'event', () => {
        nostrum_item = null;
        food_item = null;
    });

    function useItem(item) {
        if (!item || mod.game.me.level < item.data.requiredLevel) return;
        mod.send('C_USE_PREMIUM_SLOT', 1, item.packet);
    }

    function useNostrum() {
        if (currentBuffsNostrum.some(buff => abnormalityDuration(buff) > BigInt(60000))) return;
        if ((mod.settings.keep_resurrection_invincibility && abnormalityDuration(BUFF_RES_INVINCIBLE) > 0n) || abnormalityDuration(BUFF_PHOENIX) > 0n) return;
        useItem(nostrum_item);
    }

    function useFood() {
        if (BUFFS_Food_STRONGER.some(buff => abnormalityDuration(buff) > 0n)) return;
        if (currentBuffsFood.some(buff => abnormalityDuration(buff) > BigInt(60000))) return;
        useItem(food_item);
    }

    function usePremiumItems() {
        if (!mod.settings.enabled || (mod.settings.dungeon_only && !mod.game.me.inDungeon) || (!mod.settings.civil_unrest && mod.game.me.inCivilUnrest)) return;
        if (!mod.game.isIngame || mod.game.isInLoadingScreen || !mod.game.me.alive || mod.game.me.mounted || mod.game.me.inBattleground || mod.game.contract.active) return;
        useNostrum();
        useFood();
    }

    let hide_message_hook = null;
    function hookHideMessage() {
        if (hide_message_hook) mod.unhook(hide_message_hook);
        if (mod.settings.hide_message) {
            hide_message_hook = mod.hook('S_SYSTEM_MESSAGE', 1, event => {
                const msg = mod.parseSystemMessage(event.message);
                if (msg && (msg.id === 'SMT_ITEM_USED' || msg.id === 'SMT_CANT_USE_ITEM_COOLTIME')) {
                    if (mod.clientMod.nostrum.some(item => msg.tokens.ItemName === `@item:${item.id}`) ||
                        mod.clientMod.food.some(item => msg.tokens.ItemName === `@item:${item.id}`)) return false;
                }
            });
        }
    }

    let interval = null;
    function start() {
        stop();
        interval = mod.setInterval(usePremiumItems, mod.settings.interval);
    }
    function stop() {
        if (interval) mod.clearInterval(interval);
        interval = null;
    }
    function isRunning() { return !!interval; }

    async function reloadItems() {
        const nostrumData = await mod.clientInterface.queryData('/ItemData/Item@id=?/', getItemsNostrum(modeSettings), true, false, ['id', 'requiredLevel']);
        mod.clientMod.nostrum = nostrumData.map(result => result.attributes);
        const foodData = await mod.clientInterface.queryData('/ItemData/Item@id=?/', getItemsFood(modeSettings), true, false, ['id', 'requiredLevel']);
        mod.clientMod.food = foodData.map(result => result.attributes);
    }

    mod.game.on('enter_game', () => {
        modeSettings = loadModeSettings(mod);
        currentBuffsNostrum = getBuffsNostrum(modeSettings);
        currentBuffsFood = getBuffsFood(modeSettings);
        reloadItems().then(() => {
            updatePremiumItems();
            start();
        });
    });

    mod.game.on('leave_game', () => {
        stop();
        nostrum_item = null;
        food_item = null;
    });

    mod.game.me.on('resurrect', () => start());

    mod.command.add('nos', {
        $default() {
            if (ui) ui.show();
            else {
                mod.settings.enabled = !mod.settings.enabled;
                mod.command.message(mod.settings.enabled ? 'enabled' : 'disabled');
            }
        },
        on() { mod.settings.enabled = true; mod.command.message('Enabled'); },
        off() { mod.settings.enabled = false; mod.command.message('Disabled'); },
        brave() {
            modeSettings.nostrumMode = 'brave';
            saveModeSettings(mod, modeSettings);
            currentBuffsNostrum = getBuffsNostrum(modeSettings);
            reloadItems().then(() => {
                updatePremiumItems();
                if (nostrum_item) {
                    useItem(nostrum_item);
                    mod.command.message('Nos: Multi Bravery');
                } else mod.command.message('An error has occurred.');
            });
        },
        cane() {
            modeSettings.nostrumMode = 'cane';
            saveModeSettings(mod, modeSettings);
            currentBuffsNostrum = getBuffsNostrum(modeSettings);
            reloadItems().then(() => {
                updatePremiumItems();
                if (nostrum_item) {
                    useItem(nostrum_item);
                    mod.command.message('Nos: Multi Canephora');
                } else mod.command.message('An error has occurred.');
            });
        },
        power() {
            modeSettings.foodMode = 'power';
            saveModeSettings(mod, modeSettings);
            currentBuffsFood = getBuffsFood(modeSettings);
            reloadItems().then(() => {
                updatePremiumItems();
                if (food_item) {
                    useItem(food_item);
                    mod.command.message('Food: Power');
                } else mod.command.message('An error has occurred.');
            });
        },
        crit() {
            modeSettings.foodMode = 'crit';
            saveModeSettings(mod, modeSettings);
            currentBuffsFood = getBuffsFood(modeSettings);
            reloadItems().then(() => {
                updatePremiumItems();
                if (food_item) {
                    useItem(food_item);
                    mod.command.message('Food: Crit');
                } else mod.command.message('An error has occurred.');
            });
        }
    });

    let ui = null;
    if (global.TeraProxy.GUIMode) {
        ui = new SettingsUI(mod, require('./settings_structure'), mod.settings, { height: 232 });
        ui.on('update', settings => {
            mod.settings = settings;
            hookHideMessage();
            if (isRunning()) {
                stop();
                start();
            }
        });
        this.destructor = () => { if (ui) ui.close(); ui = null; };
    }
}

module.exports = { ClientMod, NetworkMod };