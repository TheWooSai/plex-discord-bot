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

## Discord Bot Setup

### Option 1: Web Setup Wizard

After starting the application and logging in, visit the **Discord Setup** page in the web interface. The wizard will guide you through:

1. Creating a Discord application
2. Creating a bot user and getting your token
3. Getting your client ID
4. Inviting the bot to your server
5. Testing the connection

### Option 2: Manual Setup

#### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name your application (e.g., "Plex Bot")
4. Click **Create**

#### 2. Create a Bot User

1. In your application, click **Bot** in the left sidebar
2. Click **Reset Token** and copy the token
3. Enable the **Server Members Intent** under Privileged Gateway Intents

#### 3. Get Your Client ID

1. Click **General Information** in the left sidebar
2. Copy the **Application ID**

#### 4. Invite the Bot to Your Server

1. Click **OAuth2** in the left sidebar
2. Under **OAuth2 URL Generator**, select these scopes:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select:
   - `Manage Roles`
   - `View Channels`
   - `Send Messages`
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

#### 5. Configure Environment Variables

Add your credentials to your `.env` file:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
```

## Plex Server Setup

### Option 1: Web Setup Wizard

After starting the application and logging in, visit the **Plex Setup** page in the web interface. The wizard will guide you through:

1. Getting your Plex authentication token
2. Finding your Plex server URL
3. Testing the connection
4. Verifying library access

You can also use **Plex OAuth** for automatic token retrieval - just click "Connect with Plex OAuth" on the setup page.

### Option 2: Manual Setup

#### 1. Get Your Plex Token

1. Go to [Plex Settings](https://plex.tv/settings)
2. Click on your profile name in the top right
3. Click **Account**
4. Find **Authentication Token** and click **Show**
5. Copy the token

#### 2. Find Your Plex Server URL

- If your Plex server is on the same machine as this bot: `http://localhost:32400`
- If it's on a different machine: `http://server-ip:32400`

#### 3. Configure Environment Variables

Add your Plex credentials to your `.env` file:

```env
PLEX_BASE_URL=http://localhost:32400
PLEX_TOKEN=your_plex_token_here
```

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