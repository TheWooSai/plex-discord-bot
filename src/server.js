require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { passport, ensureAuthenticated } = require('./auth');
const DiscordBot = require('./bot');
const { initPlex, getPlexClient } = require('./sync');
const db = require('./database');

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

// Redirect to setup if no admin user exists
function ensureSetupComplete(req, res, next) {
  if (hasAdminUser()) return next();
  res.redirect('/setup');
}

// Initialize services
initPlex(process.env.PLEX_BASE_URL, process.env.PLEX_TOKEN);

// Setup route (first-run wizard)
app.get('/setup', (req, res) => {
  if (hasAdminUser()) {
    return res.redirect('/');
  }
  res.render('setup');
});

app.post('/setup', async (req, res) => {
  if (hasAdminUser()) {
    return res.redirect('/');
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

app.post('/plex-setup', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const { baseUrl, token } = req.body;
  
  if (!baseUrl || !token) {
    return res.render('plex-setup', { error: 'Base URL and Token are required' });
  }
  
  // Test the connection by trying to fetch libraries
  const PlexClient = require('./plex');
  const testClient = new PlexClient(baseUrl, token);
  
  try {
    const libraries = await testClient.getLibraries();
    
    // Save the configuration to environment (for this session)
    process.env.PLEX_BASE_URL = baseUrl;
    process.env.PLEX_TOKEN = token;
    
    // Re-initialize the Plex client with the new credentials
    initPlex(baseUrl, token);
    
    res.render('plex-setup', { success: `Connected to Plex server! Found ${libraries.length} library/libraries.` });
  } catch (err) {
    res.render('plex-setup', { error: 'Failed to connect: ' + err.message });
  }
});

// Plex OAuth setup route
app.get('/plex-oauth', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  try {
    // Request a PIN from Plex
    const response = await axios.post('https://plex.tv/api/v2/pins', null, {
      params: {
        strong: false
      },
      headers: {
        'X-Plex-Client-Identifier': 'plex-discord-bot',
        'X-Plex-Product': 'Plex Discord Bot',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Device': 'Web',
        'X-Plex-Device-Name': 'Plex Discord Bot'
      }
    });
    
    const pinData = response.data;
    
    // Store the PIN in the session for later verification
    req.session.plexPin = pinData.id;
    req.session.plexPinCode = pinData.code;
    
    res.render('plex-oauth', {
      pin: pinData.code,
      url: pinData.web_redirect
    });
  } catch (err) {
    console.error('Plex OAuth error:', err.response ? err.response.data : err.message);
    res.render('plex-oauth', { error: 'Failed to request PIN: ' + (err.response ? err.response.data : err.message) });
  }
});

app.get('/plex-oauth/callback', ensureSetupComplete, ensureAuthenticated, async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.render('plex-oauth', { error: 'No authorization code received' });
  }
  
  try {
    // Exchange the code for a token
    const response = await axios.get(`https://plex.tv/api/v2/pins/${code}/exchange`, {
      headers: {
        'X-Plex-Client-Identifier': 'plex-discord-bot',
        'X-Plex-Product': 'Plex Discord Bot',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Device': 'Web',
        'X-Plex-Device-Name': 'Plex Discord Bot'
      }
    });
    
    const token = response.data.auth_token;
    
    // Save the token
    process.env.PLEX_TOKEN = token;
    
    // Test the connection
    const PlexClient = require('./plex');
    const testClient = new PlexClient(process.env.PLEX_BASE_URL || 'http://localhost:32400', token);
    
    try {
      const libraries = await testClient.getLibraries();
      initPlex(process.env.PLEX_BASE_URL || 'http://localhost:32400', token);
      res.render('plex-oauth', { success: `Connected to Plex server! Found ${libraries.length} library/libraries.` });
    } catch (err) {
      res.render('plex-oauth', { success: 'Plex authentication successful!', error: 'Could not connect to Plex server: ' + err.message });
    }
  } catch (err) {
    console.error('Plex OAuth callback error:', err.response ? err.response.data : err.message);
    res.render('plex-oauth', { error: 'Failed to exchange code for token: ' + (err.response ? err.response.data : err.message) });
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
