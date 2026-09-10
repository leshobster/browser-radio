function normalizeAddress(input) {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('Enter a valid website address.');
  const trimmed = input.trim();
  if (!trimmed) return 'https://www.youtube.com/';
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) throw new Error('Only http and https websites can be opened here.');
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an http or https website address without credentials.');
  return url.href;
}

function validateSettings(input, previous = {}) {
  if (!input || typeof input !== 'object') throw new Error('Enter your bot settings.');
  const ownerId = typeof input.ownerId === 'string' ? input.ownerId.trim() : '';
  if (!/^\d{17,20}$/.test(ownerId)) throw new Error('Your Discord user ID should be 17–20 digits. Enable Developer Mode in Discord, then copy your user ID.');
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const resolvedToken = token || previous.token;
  if (!resolvedToken || resolvedToken.length < 30 || resolvedToken.length > 256 || /\s/.test(resolvedToken)) throw new Error('Enter the bot token from the Discord Developer Portal.');
  return { ownerId, token: resolvedToken };
}

function selectVoiceTarget(guilds, ownerId) {
  const matches = [];
  for (const guild of guilds.values()) {
    const state = guild.voiceStates.cache.get(ownerId);
    if (state?.channelId) matches.push({ guild, channelId: state.channelId });
  }
  if (!matches.length) throw new Error('Join a server voice channel first. The bot must also be invited to that server.');
  if (matches.length > 1) throw new Error('Discord reports you in more than one server voice channel. Leave the extra voice session, then try Join again.');
  return matches[0];
}

module.exports = { normalizeAddress, validateSettings, selectVoiceTarget };
