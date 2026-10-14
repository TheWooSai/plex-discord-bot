# Plex Discord Bot

A Discord bot that manages Plex user access based on Discord roles. Users link their Plex accounts via Discord slash commands, and library access is automatically synced when their roles change.

## Features

- **Discord Slash Commands**: `/link`, `/status`, `/invite` for user interaction
- **Role-Based Access**: Map Discord roles to Plex libraries
- **Automatic Sync**: Library access updates when Discord roles change
- **Web Admin Panel**: Manage role-library mappings via a web interface
- **SQLite Database**: Persistent storage for user data and mappings
- **Docker Support**: Easy deployment with Docker and Docker Compose

## Tech Stack

- **Backend**: Node.js, Express.js
- **Discord**: discord.js v14
- **Database**: SQLite (better-sqlite3)
- **Frontend**: EJS templates
- **Auth**: Passport.js with bcrypt
- **Plex API**: axios HTTP client

## Project Structure

```
plex-discord-bot/
├── src/
│   ├── bot.js          # Discord bot logic and slash commands
│   ├── server.js       # Express web server and routes
│   ├── plex.js         # Plex API client
│   ├── database.js     # SQLite database initialization
│   ├── sync.js         # Role-to-library sync logic
│   └── auth.js         # Authentication middleware
├── views/              # EJS templates
├── public/             # Static assets
├── data/               # SQLite database (auto-created)
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```

## Prerequisites

- Node.js 18+
- npm or yarn
- A Discord bot token and client ID
- A Plex server with a valid token
- Docker (optional, for containerized deployment)

## Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd plex-discord-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
PLEX_TOKEN=your_plex_token
PLEX_BASE_URL=http://localhost:32400
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
SESSION_SECRET=your_random_session_secret
```

### 4. Run the application

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The web interface will be available at `http://localhost:3000`.

## Docker Deployment

### Build and run with Docker Compose

```bash
docker-compose up -d
```

### Build the image manually

```bash
docker build -t plex-discord-bot .
docker run -p 3000:3000 --env-file .env plex-discord-bot
```

The Docker container persists data in the `./data` directory.

## Discord Commands

| Command | Description |
|---------|-------------|
| `/link <plex_username>` | Link your Plex account to your Discord account |
| `/status` | Check your current library access and roles |
| `/invite <email>` | Request a Plex account invitation |

## Web Admin Panel

Access the admin panel at `http://localhost:3000` (login required).

- **Dashboard**: View overview of users and mappings
- **Role Mappings**: Configure which Plex libraries each Discord role can access

## Database Schema

The application uses SQLite with three main tables:

- **users**: Stores Discord user info, linked Plex username, and email
- **role_library_mappings**: Maps Discord roles to Plex library IDs
- **admin_users**: Stores admin credentials for the web panel

## License

MIT