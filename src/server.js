require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
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

// Initialize services
initPlex(process.env.PLEX_BASE_URL, process.env.PLEX_TOKEN);

// Routes
app.get('/', ensureAuthenticated, (req, res) => {
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

app.get('/roles', ensureAuthenticated, async (req, res) => {
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

app.post('/roles', ensureAuthenticated, async (req, res) => {
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

// Start bot and server
const bot = new DiscordBot(process.env.DISCORD_TOKEN, process.env.DISCORD_CLIENT_ID);
bot.login();

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
