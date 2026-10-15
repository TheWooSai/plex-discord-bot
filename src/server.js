require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const axios = require('axios');
const fs = require('fs');
const { passport, ensureAuthenticated } = require('./auth');
const DiscordBot = require('./bot');
const { initPlex, getPlexClient } = require('./sync');
const db = require('./database');

// Logging setup
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Data directory
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Log rotation settings
const settingsFile = path.join(dataDir, 'settings.json');
let maxLogSize = 1024 * 1024; // Default: 1MB

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      if (settings.maxLogSize) {
        maxLogSize = settings.maxLogSize;
      }
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

loadSettings();

function rotateLogs() {
  try {
    const logFiles = fs.readdirSync(logDir)
      .filter(f => f.startsWith('app-') && f.endsWith('.log'))
      .sort();
    
    // Keep only the most recent logs within the size limit
    let totalSize = 0;
    for (const file of logFiles) {
      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }
    
    // If total size exceeds max, delete oldest logs
    while (totalSize > maxLogSize && logFiles.length > 1) {
      const oldestFile = logFiles.shift();
      const filePath = path.join(logDir, oldestFile);
      const stats = fs.statSync(filePath);
      fs.unlinkSync(filePath);
      totalSize -= stats.size;
      console.log('Rotated log file:', oldestFile);
    }
  } catch (err) {
    console.error('Failed to rotate logs:', err);
  }
}

// Rotate logs on startup
rotateLogs();

const logFile = path.join(logDir, `app-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage);
  console.log(message);
}

// Persistent Plex token storage
const plexTokenFile = path.join(dataDir, 'plex-token.json');

function loadPlexToken() {
  try {
    if (fs.existsSync(plexTokenFile)) {
      const data = JSON.parse(fs.readFileSync(plexTokenFile, 'utf-8'));
      return data.token;
    }
  } catch (err) {
    console.error('Failed to load Plex token:', err);
  }
  return null;
}

function savePlexToken(token) {
  try {
    fs.writeFileSync(plexTokenFile, JSON.stringify({ token: token }, null, 2));
  } catch (err) {
    console.error('Failed to save Plex token:', err);
  }
}

function hasValidPlexToken() {
  return !!loadPlexToken();
}

// Load existing token on startup
const existingToken = loadPlexToken();
if (existingToken) {
  process.env.PLEX_TOKEN = existingToken;
  log('Loaded existing Plex token from file');
}

log('Server starting...');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Check if admin user exists
function hasAdminUser() {
  const admin = db.prepare('SELECT * FROM admin_users LIMIT 1').get();
  return !!admin;
}

// Redirect to setup if no admin user exists or no valid Plex token
function ensureSetupComplete(req, res, next) {
  if (hasAdminUser() && hasValidPlexToken()) return next();
  res.redirect('/setup');
}

// Initialize services
initPlex(process.env.PLEX_BASE_URL, process.env.PLEX_TOKEN);

// Setup route (first-run wizard)
app.get('/setup', (req, res) => {
  if (hasAdminUser() && hasValidPlexToken()) {
    return res.redirect('/');
  }
  
  // If admin user already exists but no Plex token, redirect to Plex OAuth
  if (hasAdminUser()) {
    return res.redirect('/plex-oauth');
  }
  
  res.render('setup');
});

app.post('/setup', async (req, res) => {
  if (hasAdminUser() && hasValidPlexToken()) {
    return res.redirect('/');
  }
  
  // If admin user already exists but no Plex token, redirect to Plex OAuth
  if (hasAdminUser()) {
    return res.redirect('/plex-oauth');
  }
  
  const { username, password, passwordConfirm } = req.body;
  
  if (!username || !password) {
    return res.render('setup', { error: 'Username and password are required' });
  }
  
  if (password !== passwordConfirm) {
    return res.render('setup', { error: 'Passwords do not match' });
  }
  
  if (password.length < 6) {
    return res.render('setup', { error: 'Password must be at least 6 characters' });
  }
  
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    console.log('Admin user created:', username);
    res.redirect('/login');
  } catch (err) {
    console.error('Failed to create admin user:', err);
    res.render('setup', { error: 'Failed to create admin user' });
  }
});

// Routes
app.get('/', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  res.render('index', { user: req.user });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login'
}));

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/login');
});

app.get('/roles', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const mappings = db.prepare('SELECT * FROM role_library_mappings').all();
  
  let libraries = [];
  try {
    const plexClient = getPlexClient();
    if (plexClient) {
      libraries = await plexClient.getLibraries();
    }
  } catch (err) {
    console.error('Failed to load Plex libraries:', err);
  }
  
  res.render('roles', { mappings, libraries });
});

app.post('/roles', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const { role_id, role_name, library_ids } = req.body;
  
  // Clear existing mappings for this role
  db.prepare('DELETE FROM role_library_mappings WHERE discord_role_id = ?').run(role_id);
  
  // Get library names from Plex
  const plexClient = getPlexClient();
  let libraries = [];
  try {
    if (plexClient) {
      libraries = await plexClient.getLibraries();
    }
  } catch (err) {
    console.error('Failed to load Plex libraries:', err);
  }
  
  // Insert new mappings with actual library names
  for (const libId of library_ids) {
    const lib = libraries.find(l => l.key == libId);
    const libName = lib ? lib.title : `Library ${libId}`;
    db.prepare(`
      INSERT INTO role_library_mappings (discord_role_id, discord_role_name, plex_library_id, plex_library_name)
      VALUES (?, ?, ?, ?)
    `).run(role_id, role_name, libId, libName);
  }
  
  res.redirect('/roles');
});

// Discord bot setup route
app.get('/discord-setup', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  res.render('discord-setup');
});

app.post('/discord-setup', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const { token, clientId } = req.body;
  
  if (!token || !clientId) {
    return res.render('discord-setup', { error: 'Token and Client ID are required' });
  }
  
  // Test the connection by trying to login
  const { Client } = require('discord.js');
  const testClient = new Client();
  
  try {
    await testClient.login(token);
    await testClient.destroy();
    
    // Save the configuration to environment (for this session)
    process.env.DISCORD_TOKEN = token;
    process.env.DISCORD_CLIENT_ID = clientId;
    
    res.render('discord-setup', { success: 'Discord bot connected successfully! Configuration saved.' });
  } catch (err) {
    res.render('discord-setup', { error: 'Failed to connect: ' + err.message });
  }
});

// Plex server setup route
app.get('/plex-setup', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  res.render('plex-setup');
});

// Plex OAuth setup route
app.get('/plex-oauth', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  log('Plex OAuth: Requesting PIN from Plex...');
  try {
    // Request a PIN from Plex
    const response = await axios.post('https://plex.tv/api/v2/pins', null, {
      params: {
        strong: false
      },
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': 'plex-discord-bot',
        'X-Plex-Product': 'Plex Discord Bot',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Device': 'Web',
        'X-Plex-Device-Name': 'Plex Discord Bot'
      }
    });
    
    log('Plex OAuth: Response status: ' + response.status);
    log('Plex OAuth: Response data: ' + JSON.stringify(response.data));
    
    const pinData = response.data;
    log('Plex OAuth: PIN received: ' + pinData.code);
    
    // Store the PIN in the session for later verification
    req.session.plexPin = pinData.id;
    req.session.plexPinCode = pinData.code;
    
    // Construct the web redirect URL (Plex API doesn't always provide it)
    const webRedirectUrl = 'https://www.plex.tv/link/';
    
    log('Plex OAuth: Rendering PIN page with PIN: ' + pinData.code + ' and URL: ' + webRedirectUrl);
    
    res.render('plex-oauth', {
      pin: pinData.code,
      url: webRedirectUrl
    });
  } catch (err) {
    const errorMessage = err.response ? err.response.data : err.message;
    log('Plex OAuth error: ' + errorMessage);
    res.render('plex-oauth', { error: 'Failed to request PIN: ' + errorMessage });
  }
});

// Poll for PIN authorization
app.get('/plex-oauth/poll', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const pinId = req.session.plexPin;
  
  if (!pinId) {
    return res.json({ status: 'no_pin' });
  }
  
  try {
    log('Plex OAuth: Polling for PIN authorization...');
    
    const response = await axios.get(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': 'plex-discord-bot',
        'X-Plex-Product': 'Plex Discord Bot',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Device': 'Web',
        'X-Plex-Device-Name': 'Plex Discord Bot'
      }
    });
    
    const pinData = response.data;
    log('Plex OAuth: Poll response: ' + JSON.stringify(pinData));
    
    if (pinData.authToken) {
      // PIN has been authorized, we have the token directly
      log('Plex OAuth: PIN authorized, token received');
      
      const token = pinData.authToken;
      
      // Save the token
      process.env.PLEX_TOKEN = token;
      savePlexToken(token);
      log('Plex OAuth: Token saved to file');
      
      // Get user's Plex account info
      log('Plex OAuth: Getting user account info...');
      const meResponse = await axios.get('https://plex.tv/api/v2/user', {
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': token
        }
      });
      
      log('Plex OAuth: User account info received');
      const user = meResponse.data;
      log('Plex OAuth: User: ' + user.title);
      
      // Get user's resources (servers)
      log('Plex OAuth: Getting user resources...');
      const resourcesResponse = await axios.get('https://plex.tv/api/v2/resources', {
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': token,
          'X-Plex-Client-Identifier': 'plex-discord-bot'
        }
      });
      
      log('Plex OAuth: Resources received');
      const resources = resourcesResponse.data;
      
      // Log resources for debugging
      log('Plex OAuth: Resources count: ' + (Array.isArray(resources) ? resources.length : 'not array'));
      if (Array.isArray(resources) && resources.length > 0) {
        log('Plex OAuth: First resource provider: ' + (resources[0].provider || 'none'));
        log('Plex OAuth: First resource name: ' + (resources[0].name || 'none'));
      }
      
      // Find servers - filter by product name, owned status, and provider
      const servers = resources.filter(r => 
        (r.product === 'Plex Media Server' || (r.server && r.provider === 'com.plexapp.plugins.myplex')) &&
        r.owned === true
      );
      log('Plex OAuth: Found ' + servers.length + ' Plex servers (owned only)');
      if (servers.length === 0) {
        return res.json({ status: 'no_servers' });
      }
      
      // Store servers and token in session
      req.session.plexToken = token;
      req.session.plexServers = servers;
      
      // If only one server, auto-select it
      if (servers.length === 1) {
        const server = servers[0];
        log('Plex OAuth: Auto-selecting single server: ' + server.name);
        
        // Redirect to library selection with the server pre-selected
        return res.json({ status: 'success', redirect: '/plex-libraries?server=' + encodeURIComponent(server.id) });
      }
      
      // Multiple servers - redirect to server selection page
      log('Plex OAuth: Redirecting to server selection for ' + servers.length + ' servers');
      return res.json({ status: 'success', redirect: '/plex-server-select' });
    } else if (pinData.expiresIn <= 0) {
      return res.json({ status: 'expired' });
    }
    
    return res.json({ status: 'pending' });
  } catch (err) {
    log('Plex OAuth poll error: ' + JSON.stringify(err.response ? err.response.data : err.message));
    return res.json({ status: 'error', message: err.message });
  }
});

app.get('/plex-oauth/callback', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.render('plex-oauth', { error: 'No authorization code received' });
  }
  
  try {
    log('Plex OAuth: Exchanging code for token...');
    
    // Exchange the code for a token
    const exchangeResponse = await axios.get(`https://plex.tv/api/v2/pins/${code}/exchange`, {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': 'plex-discord-bot',
        'X-Plex-Product': 'Plex Discord Bot',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Device': 'Web',
        'X-Plex-Device-Name': 'Plex Discord Bot'
      }
    });
    
    log('Plex OAuth: Exchange response status: ' + exchangeResponse.status);
    
    const token = exchangeResponse.data.auth_token;
    if (!token) {
      throw new Error('No auth_token in exchange response');
    }
    
    log('Plex OAuth: Token received');
    
    // Save the token
    process.env.PLEX_TOKEN = token;
    savePlexToken(token);
    log('Plex OAuth: Token saved to file');
    
    // Get user's Plex account info
    log('Plex OAuth: Getting user account info...');
    const meResponse = await axios.get('https://plex.tv/api/v2/user', {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': token
      }
    });
    
    log('Plex OAuth: User account info received');
    const user = meResponse.data;
    log('Plex OAuth: User: ' + user.title);
    
    // Get user's resources (servers)
    log('Plex OAuth: Getting user resources...');
    const resourcesResponse = await axios.get('https://plex.tv/api/v2/resources', {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': 'plex-discord-bot'
      }
    });
    
    log('Plex OAuth: Resources received');
    const resources = resourcesResponse.data;
    
    // Find servers - filter by product name, owned status, and provider
    const servers = resources.filter(r => 
      (r.product === 'Plex Media Server' || (r.server && r.provider === 'com.plexapp.plugins.myplex')) &&
      r.owned === true
    );
    if (servers.length === 0) {
      return res.render('plex-oauth', { 
        success: 'Plex authentication successful!', 
        error: 'No Plex servers found for this account.' 
      });
    }
    
    // Store servers and token in session
    req.session.plexToken = token;
    req.session.plexServers = servers;
    
    // If only one server, auto-select it
    if (servers.length === 1) {
      const server = servers[0];
      log('Plex OAuth: Auto-selecting single server: ' + server.name);
      
      // Redirect to library selection with the server pre-selected
      return res.redirect('/plex-libraries?server=' + encodeURIComponent(server.id));
    }
    
    // Multiple servers - show server selection page
    log('Plex OAuth: Showing server selection for ' + servers.length + ' servers');
    res.render('plex-server-select', { servers: servers });
  } catch (err) {
    log('Plex OAuth callback error: ' + (err.response ? err.response.data : err.message));
    res.render('plex-oauth', { 
      error: 'Failed to exchange code for token: ' + (err.response ? err.response.data : err.message) 
    });
  }
});

// Server selection route
app.get('/plex-server-select', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  const servers = req.session.plexServers;
  if (!servers || servers.length === 0) {
    return res.redirect('/plex-oauth');
  }
  res.render('plex-server-select', { servers: servers });
});

// Library selection route
app.get('/plex-libraries', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const serverId = req.query.server;
  const servers = req.session.plexServers;
  const token = req.session.plexToken;
  
  if (!serverId || !servers || !token) {
    return res.redirect('/plex-oauth');
  }
  
  // Find the selected server
  const server = servers.find(s => s.id === serverId);
  if (!server) {
    return res.render('plex-server-select', { servers: servers, error: 'Invalid server selected' });
  }
  
  log('Plex OAuth: Getting libraries for server: ' + server.name);
  
  try {
    // Connect to the server and get libraries
    const PlexClient = require('./plex');
    const plexClient = new PlexClient(server.baseURL, token);
    
    const libraries = await plexClient.getLibraries();
    log('Plex OAuth: Found ' + libraries.length + ' libraries');
    
    // Initialize with the discovered server
    initPlex(server.baseURL, token);
    
    // Store server info for later use
    req.session.plexServer = {
      name: server.name,
      id: server.id,
      baseUrl: server.baseURL,
      token: token
    };
    
    res.render('plex-libraries', { 
      server: server,
      libraries: libraries,
      servers: servers
    });
  } catch (err) {
    log('Plex OAuth error getting libraries: ' + err.message);
    res.render('plex-server-select', { 
      servers: servers,
      error: 'Could not connect to Plex server: ' + err.message 
    });
  }
});

// Save library settings route
app.post('/plex-libraries/save', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  const { serverId } = req.body;
  const servers = req.session.plexServers;
  
  if (!serverId || !servers) {
    return res.redirect('/plex-oauth');
  }
  
  // Find the selected server
  const server = servers.find(s => s.id === serverId);
  if (!server) {
    return res.render('plex-server-select', { servers: servers, error: 'Invalid server selected' });
  }
  
  log('Plex OAuth: Saving library settings for server: ' + server.name);
  
  // Process the library settings
  // For now, just log them
  const librarySettings = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (key.startsWith('managed_') || key.startsWith('do_not_add_') || key.startsWith('do_not_remove_')) {
      librarySettings[key] = value === 'on';
    }
  }
  
  log('Plex OAuth: Library settings: ' + JSON.stringify(librarySettings));
  
  // Redirect back to the library page with success message
  res.redirect('/plex-libraries?server=' + encodeURIComponent(serverId) + '&saved=true');
});

// Settings route
app.get('/settings', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  const settings = {
    maxLogSizeMB: Math.round(maxLogSize / (1024 * 1024))
  };
  res.render('settings', { settings });
});

app.post('/settings', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  const { maxLogSizeMB } = req.body;
  
  if (!maxLogSizeMB || maxLogSizeMB < 1) {
    return res.render('settings', { 
      settings: { maxLogSizeMB: Math.round(maxLogSize / (1024 * 1024)) },
      error: 'Invalid max log size'
    });
  }
  
  maxLogSize = maxLogSizeMB * 1024 * 1024;
  saveSettings({ maxLogSize: maxLogSize });
  
  res.render('settings', { 
    settings: { maxLogSizeMB: parseInt(maxLogSizeMB) },
    success: 'Settings saved successfully'
  });
});

// Log viewer route
app.get('/logs', ensureSetupComplete, ensureAuthenticated, (req, res) => {
  try {
    // Find the most recent log file
    const logFiles = fs.readdirSync(logDir)
      .filter(f => f.startsWith('app-') && f.endsWith('.log'))
      .sort()
      .reverse();
    
    if (logFiles.length > 0) {
      const latestLog = path.join(logDir, logFiles[0]);
      const logs = fs.readFileSync(latestLog, 'utf-8');
      res.render('logs', { logs });
    } else {
      res.render('logs', { logs: 'No log files found.' });
    }
  } catch (err) {
    res.render('logs', { logs: 'Error reading log file: ' + err.message });
  }
});

// Start bot and server
const bot = new DiscordBot(process.env.DISCORD_TOKEN, process.env.DISCORD_CLIENT_ID);
bot.login().catch(err => {
  console.error('Failed to start Discord bot:', err.message);
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
