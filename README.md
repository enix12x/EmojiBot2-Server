# EmojiBot2

A bot for CollabVM which can send Emojis into the chat using XSS. Now with MySQL backend and admin panel!

## Features

- **MySQL Database**: All emojis and users are stored in a MySQL database
- **Admin Panel**: Web-based panel for managing users and emojis
- **User System**: Registration, verification, and admin management
- **Emoji Management**: Create, view, and delete emojis through the panel
- **VM-Specific Emojis**: Assign emojis to specific VMs

## Setup

### Prerequisites

- Node.js and npm/yarn
- MySQL database server
- CollabVM server access

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd emojibot
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Set up MySQL database:
```sql
CREATE DATABASE emojibot;
CREATE USER 'emojibot'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON emojibot.* TO 'emojibot'@'localhost';
FLUSH PRIVILEGES;
```

4. Copy and configure:
```bash
cp config.example.json config.json
# Edit config.json with your settings
```

5. Build the bot:
```bash
npm run build
# or
yarn build
```

6. Run the bot:
```bash
npm run serve
# or
yarn serve
# or
node dist/index.js
```

### Configuration

Edit `config.json` with your settings:

- `prefix`: Command prefix for bot commands (default: "-")
- `vms`: Array of VM configurations with `url` and `nodeId`
- `authType`: Authentication type ("password" or "token")
- `adminPassword`: Staff password (if using password auth)
- `botToken`: Bot token (if using token auth)
- `loginAs`: Login as "admin" or "mod"
- `username`: Bot username
- `colonEmoji`: Enable `:emoji:` syntax (boolean)
- `database`: MySQL connection settings
- `apiPort`: Port for the API server (default: 3000)
- `apiSecret`: Secret key for API authentication (must match panel's `apiSecret`)
- `apiUrl`: URL where the API server is accessible (e.g., `http://localhost:3000`)

### Environment Variables

- `JWT_SECRET`: Secret key for JWT tokens (defaults to a placeholder - **change this in production!**)

## Panel Setup

The admin panel is located in the `/panel` directory.

1. Navigate to the panel directory:
```bash
cd panel
```

2. Install dependencies:
```bash
npm install
```

3. Copy and configure the panel config:
```bash
cp config.example.json config.json
# Edit config.json:
#   - Set apiUrl to match the main bot's apiUrl
#   - Set apiSecret to match the main bot's apiSecret
```

4. Build the panel:
```bash
npm run build
```

5. Run the panel server:
```bash
npm run serve
```

The panel will be available at `http://localhost:3001` by default.

**Important**: The `apiSecret` in the panel's `config.json` must exactly match the `apiSecret` in the main bot's `config.json` for secure communication.

## Usage

### Bot Commands

- `-help` - Show help message
- `-emojilist` - List available emojis for the current VM
- `-emoji <name>` - Send an emoji (requires admin/mod)
- `:emoji:` - Send emoji using colon syntax (if enabled)

### User System

1. **Registration**: Users can register through the panel
2. **Verification**: The first user automatically becomes an admin. Other users must be verified by an admin before they can log in.
3. **Admin Features**: Admins can:
   - Verify users
   - Make users admins
   - Block/unblock users
   - Create and delete emojis

### Creating Emojis

1. Log in to the panel (verified users only)
2. Click "Create Emoji"
3. Fill in:
   - Name: Unique emoji name
   - Web Address: Full URL to the emoji image
   - Description: Description of the emoji
   - VMs: Select which VMs this emoji should be available on
4. Click "Create"

Emojis are immediately available on the selected VMs.

## SystemD Service

### Bot Service

There is a premade SystemD service file in `emojibot.example.service`. Copy it to `/etc/systemd/system/emojibot.service` and modify the `WorkingDirectory` path, then:

```bash
sudo cp emojibot.example.service /etc/systemd/system/emojibot.service
sudo nano /etc/systemd/system/emojibot.service  # Edit WorkingDirectory and User/Group
sudo systemctl daemon-reload
sudo systemctl enable emojibot
sudo systemctl start emojibot
```

### Panel Service

There is also a SystemD service file for the panel in `panel/emojibot-panel.example.service`. Copy it to `/etc/systemd/system/emojibot-panel.service` and modify the `WorkingDirectory` path, then:

```bash
sudo cp panel/emojibot-panel.example.service /etc/systemd/system/emojibot-panel.service
sudo nano /etc/systemd/system/emojibot-panel.service  # Edit WorkingDirectory and User/Group
sudo systemctl daemon-reload
sudo systemctl enable emojibot-panel
sudo systemctl start emojibot-panel
```

## Architecture

- **Bot** (`src/index.ts`): Main bot that connects to CollabVM
- **Database** (`src/database.ts`): MySQL database operations
- **API** (`src/api.ts`): Express API server for the panel
- **Panel** (`panel/`): Web-based admin panel

## License

MIT
