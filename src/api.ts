import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import * as db from './database';

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const JWT_EXPIRY = '7d';

let vmList: string[] = [];
let apiSecret: string = '';

function verifyApiSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = req.headers['x-api-secret'] as string;
  
  if (!secret || secret !== apiSecret) {
    return res.status(401).json({ error: 'Invalid or missing API secret' });
  }
  next();
}

interface AuthRequest extends express.Request {
  user?: {
    id: number;
    username: string;
    is_admin: boolean;
    is_moderator: boolean;
  };
}

function authenticateToken(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user as { id: number; username: string; is_admin: boolean; is_moderator: boolean };
    next();
  });
}

function requireAdmin(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireAdminOrMod(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user || (!req.user.is_admin && !req.user.is_moderator)) {
    return res.status(403).json({ error: 'Admin or moderator access required' });
  }
  next();
}
app.post('/api/register', verifyApiSecret, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await db.getUserByUsername(username) || await db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser(username, email, passwordHash);

    const { password_hash, ...userWithoutPassword } = user;
    res.status(201).json({ user: userWithoutPassword });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

app.post('/api/login', verifyApiSecret, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Account is blocked' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Account not verified. Please wait for an administrator to verify your account.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin, is_moderator: user.is_moderator },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    const { password_hash, ...userWithoutPassword } = user;
    res.json({ token, user: userWithoutPassword });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

app.get('/api/me', verifyApiSecret, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await db.getUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { password_hash, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message || 'Failed to get user' });
  }
});

app.get('/api/users', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({ users });
  } catch (error: any) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message || 'Failed to get users' });
  }
});

app.patch('/api/users/:id', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { is_admin, is_moderator, is_verified, is_blocked } = req.body;

    const updates: any = {};
    if (is_admin !== undefined) updates.is_admin = is_admin;
    if (is_moderator !== undefined) updates.is_moderator = is_moderator;
    if (is_verified !== undefined) updates.is_verified = is_verified;
    if (is_blocked !== undefined) updates.is_blocked = is_blocked;

    await db.updateUser(userId, updates);
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { password_hash, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

app.delete('/api/users/:id', verifyApiSecret, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = parseInt(req.params.id);
    const currentUser = await db.getUserById(req.user!.id);
    
    if (!currentUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!currentUser.is_admin && currentUser.id !== userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    
    if (currentUser.is_admin && currentUser.id === userId) {
      const allUsers = await db.getAllUsers();
      const adminCount = allUsers.filter(u => u.is_admin && u.id !== userId).length;
      if (adminCount === 0) {
        return res.status(400).json({ error: 'Cannot delete the last admin' });
      }
    }
    
    await db.deleteUser(userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});
app.get('/api/vms', verifyApiSecret, authenticateToken, async (req, res) => {
  try {
    res.json({ vms: vmList });
  } catch (error: any) {
    console.error('Get VMs error:', error);
    res.status(500).json({ error: error.message || 'Failed to get VMs' });
  }
});

app.get('/api/emojis', verifyApiSecret, authenticateToken, async (req, res) => {
  try {
    const emojis = await db.getAllEmojis();
    res.json({ emojis });
  } catch (error: any) {
    console.error('Get emojis error:', error);
    res.status(500).json({ error: error.message || 'Failed to get emojis' });
  }
});

app.post('/api/emojis', verifyApiSecret, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await db.getUserById(req.user!.id);
    if (!user || !user.is_verified) {
      return res.status(403).json({ error: 'Verified account required to create emojis' });
    }

    const { name, web_address, description, vm_node_ids } = req.body;

    if (!name || !web_address || !description || !Array.isArray(vm_node_ids) || vm_node_ids.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const isBlocked = await db.isDomainBlocked(web_address);
    if (isBlocked) {
      return res.status(400).json({ error: 'This domain is blocked. Please use a different image URL.' });
    }

    const emoji = await db.createEmoji(name, web_address, description, req.user!.id, vm_node_ids);
    
    if ((global as any).refreshEmojiCache) {
      (global as any).refreshEmojiCache();
    }
    
    res.status(201).json({ emoji });
  } catch (error: any) {
    console.error('Create emoji error:', error);
    res.status(500).json({ error: error.message || 'Failed to create emoji' });
  }
});

app.delete('/api/emojis/:id', verifyApiSecret, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const emojiId = parseInt(req.params.id);
    const emoji = await db.getEmojiById(emojiId);

    if (!emoji) {
      return res.status(404).json({ error: 'Emoji not found' });
    }

    const user = await db.getUserById(req.user!.id);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!user.is_admin && emoji.created_by !== user.id) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    await db.deleteEmoji(emojiId);
    
    if ((global as any).refreshEmojiCache) {
      (global as any).refreshEmojiCache();
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete emoji error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete emoji' });
  }
});

app.post('/api/emojis/refresh', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    if ((global as any).refreshEmojiCache) {
      await (global as any).refreshEmojiCache();
      res.json({ success: true, message: 'Emoji cache refreshed' });
    } else {
      res.status(500).json({ error: 'Refresh function not available' });
    }
  } catch (error: any) {
    console.error('Refresh cache error:', error);
    res.status(500).json({ error: error.message || 'Failed to refresh cache' });
  }
});

let vmConnections: Map<string, any> = new Map();

export function setVMConnections(connections: Map<string, any>) {
  vmConnections = connections;
}

app.get('/api/settings', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({});
  } catch (error: any) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: error.message || 'Failed to get settings' });
  }
});

app.post('/api/settings', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json({ success: true });
  } catch (error: any) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: error.message || 'Failed to update settings' });
  }
});

app.get('/api/emoji-requests', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const requests = await db.getEmojiRequests(limit);
    res.json({ requests });
  } catch (error: any) {
    console.error('Get emoji requests error:', error);
    res.status(500).json({ error: error.message || 'Failed to get emoji requests' });
  }
});

app.get('/api/blocked-domains', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const domains = await db.getAllBlockedDomains();
    res.json({ domains });
  } catch (error: any) {
    console.error('Get blocked domains error:', error);
    res.status(500).json({ error: error.message || 'Failed to get blocked domains' });
  }
});

app.post('/api/blocked-domains', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    await db.addBlockedDomain(domain);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Add blocked domain error:', error);
    res.status(500).json({ error: error.message || 'Failed to add blocked domain' });
  }
});

app.delete('/api/blocked-domains/:domain', verifyApiSecret, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const domain = decodeURIComponent(req.params.domain);
    await db.removeBlockedDomain(domain);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Remove blocked domain error:', error);
    res.status(500).json({ error: error.message || 'Failed to remove blocked domain' });
  }
});

function encodeGuacArray(arr: string[]): string {
  return arr.map(s => `${Buffer.byteLength(s, 'utf8')}.${s}`).join(',') + ';';
}

export function startAPI(port: number, vms: string[], secret: string) {
  vmList = vms;
  apiSecret = secret;
  app.listen(port, () => {
    console.log(`API server running on port ${port}`);
  });
}

