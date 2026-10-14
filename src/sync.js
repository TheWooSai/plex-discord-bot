const db = require('./database');
const PlexClient = require('./plex');

let plexClient = null;

function initPlex(baseUrl, token) {
  plexClient = new PlexClient(baseUrl, token);
}

function getPlexClient() {
  return plexClient;
}

async function syncUserLibraries(discordId) {
  const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
  if (!user || !user.plex_username) return;

  const plexUsers = await plexClient.getUsers();
  const plexUser = plexUsers.find(u => u.username === user.plex_username);
  if (!plexUser) return;

  // Get the user's Discord roles
  let roleIds = [];
  try {
    roleIds = JSON.parse(user.discord_role_ids || '[]');
  } catch (e) {
    console.error('Failed to parse role IDs for user:', discordId, e);
    return;
  }

  if (roleIds.length === 0) return;

  // Get library mappings for the user's roles
  const placeholders = roleIds.map(() => '?').join(',');
  const roleMappings = db.prepare(`
    SELECT * FROM role_library_mappings
    WHERE discord_role_id IN (${placeholders})
  `).all(roleIds);

  // Collect unique library IDs the user should have access to
  const libraryIds = [...new Set(roleMappings.map(m => m.plex_library_id))];

  console.log(`Syncing libraries for ${user.plex_username} (user ${plexUser.id}): ${libraryIds.join(', ')}`);

  // TODO: Implement actual library sync logic (add/remove grants)
}

async function syncAllUsers() {
  const users = db.prepare('SELECT * FROM users').all();
  for (const user of users) {
    await syncUserLibraries(user.discord_id);
  }
}

module.exports = { initPlex, getPlexClient, syncUserLibraries, syncAllUsers };
