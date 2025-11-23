import mysql from 'mysql2/promise';

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  is_moderator: boolean;
  is_verified: boolean;
  is_blocked: boolean;
  created_at: Date;
}

export interface Emoji {
  id: number;
  name: string;
  web_address: string;
  description: string;
  created_by: number;
  created_at: Date;
}

export interface VMEmoji {
  emoji_id: number;
  vm_node_id: string;
}

let pool: mysql.Pool | null = null;

export async function initDatabase(config: {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
}) {
  pool = mysql.createPool({
    host: config.host,
    user: config.user,
    password: config.password,
    database: config.database,
    port: config.port || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });


  await createTables();
  console.log('Database initialized successfully');
}

async function createTables() {
  if (!pool) throw new Error('Database not initialized');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      is_moderator BOOLEAN DEFAULT FALSE,
      is_verified BOOLEAN DEFAULT FALSE,
      is_blocked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  try {
    await pool.execute('ALTER TABLE users ADD COLUMN is_moderator BOOLEAN DEFAULT FALSE');
  } catch (e: any) {
    if (!e.message.includes('Duplicate column name')) {
      console.warn('Could not add is_moderator column:', e.message);
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS emojis (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      web_address VARCHAR(512) NOT NULL,
      description TEXT,
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS vm_emojis (
      emoji_id INT NOT NULL,
      vm_node_id VARCHAR(255) NOT NULL,
      PRIMARY KEY (emoji_id, vm_node_id),
      FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE
    )
  `);
  

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS emoji_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      emoji_id INT NOT NULL,
      vm_node_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (emoji_id) REFERENCES emojis(id) ON DELETE CASCADE
    )
  `);
  
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS blocked_domains (
      id INT AUTO_INCREMENT PRIMARY KEY,
      domain VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function getFirstUser(): Promise<User | null> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT * FROM users ORDER BY id ASC LIMIT 1');
  const users = rows as User[];
  return users.length > 0 ? users[0] : null;
}

export async function createUser(
  username: string,
  email: string,
  passwordHash: string
): Promise<User> {
  if (!pool) throw new Error('Database not initialized');
  
  const isFirstUser = (await getFirstUser()) === null;
  
  const [result] = await pool.execute(
    'INSERT INTO users (username, email, password_hash, is_admin, is_moderator, is_verified) VALUES (?, ?, ?, ?, ?, ?)',
    [username, email, passwordHash, isFirstUser, false, isFirstUser]
  );
  
  const insertResult = result as mysql.ResultSetHeader;
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [insertResult.insertId]);
  const users = rows as User[];
  return users[0];
}

export async function getUserByUsername(username: string): Promise<User | null> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
  const users = rows as User[];
  return users.length > 0 ? users[0] : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
  const users = rows as User[];
  return users.length > 0 ? users[0] : null;
}

export async function getUserById(id: number): Promise<User | null> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
  const users = rows as User[];
  return users.length > 0 ? users[0] : null;
}

export async function getAllUsers(): Promise<User[]> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT id, username, email, is_admin, is_moderator, is_verified, is_blocked, created_at FROM users');
  return rows as User[];
}

export async function deleteUser(id: number): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  await pool.execute('DELETE FROM users WHERE id = ?', [id]);
}

export async function updateUser(
  id: number,
  updates: Partial<{ is_admin: boolean; is_moderator: boolean; is_verified: boolean; is_blocked: boolean }>
): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.is_admin !== undefined) {
    fields.push('is_admin = ?');
    values.push(updates.is_admin);
    if (updates.is_admin) {
      fields.push('is_moderator = ?');
      values.push(false);
    }
  }
  if (updates.is_moderator !== undefined) {
    fields.push('is_moderator = ?');
    values.push(updates.is_moderator);
    if (updates.is_moderator) {
      fields.push('is_admin = ?');
      values.push(false);
    }
  }
  if (updates.is_verified !== undefined) {
    fields.push('is_verified = ?');
    values.push(updates.is_verified);
  }
  if (updates.is_blocked !== undefined) {
    fields.push('is_blocked = ?');
    values.push(updates.is_blocked);
  }
  
  if (fields.length === 0) return;
  
  values.push(id);
  await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function createEmoji(
  name: string,
  webAddress: string,
  description: string,
  createdBy: number,
  vmNodeIds: string[]
): Promise<Emoji> {
  if (!pool) throw new Error('Database not initialized');
  
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const [result] = await connection.execute(
      'INSERT INTO emojis (name, web_address, description, created_by) VALUES (?, ?, ?, ?)',
      [name, webAddress, description, createdBy]
    );
    
    const insertResult = result as mysql.ResultSetHeader;
    const emojiId = insertResult.insertId;
    
    for (const vmNodeId of vmNodeIds) {
      await connection.execute(
        'INSERT INTO vm_emojis (emoji_id, vm_node_id) VALUES (?, ?)',
        [emojiId, vmNodeId]
      );
    }
    
    await connection.commit();
    
    const [rows] = await connection.execute('SELECT * FROM emojis WHERE id = ?', [emojiId]);
    const emojis = rows as Emoji[];
    return emojis[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getEmojisForVM(vmNodeId: string): Promise<Emoji[]> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute(
    `SELECT e.* FROM emojis e
     INNER JOIN vm_emojis ve ON e.id = ve.emoji_id
     WHERE ve.vm_node_id = ?`,
    [vmNodeId]
  );
  return rows as Emoji[];
}

export async function getAllEmojis(): Promise<(Emoji & { created_by_username: string; vm_node_ids: string[] })[]> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute(
    `SELECT e.*, u.username as created_by_username,
     GROUP_CONCAT(ve.vm_node_id) as vm_node_ids
     FROM emojis e
     LEFT JOIN users u ON e.created_by = u.id
     LEFT JOIN vm_emojis ve ON e.id = ve.emoji_id
     GROUP BY e.id`
  );
  
  const emojis = rows as any[];
  return emojis.map(e => ({
    ...e,
    vm_node_ids: e.vm_node_ids ? e.vm_node_ids.split(',') : []
  }));
}

export async function deleteEmoji(id: number): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  await pool.execute('DELETE FROM emojis WHERE id = ?', [id]);
}

export async function getEmojiById(id: number): Promise<Emoji | null> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT * FROM emojis WHERE id = ?', [id]);
  const emojis = rows as Emoji[];
  return emojis.length > 0 ? emojis[0] : null;
}

export async function getSetting(key: string): Promise<string | null> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT value FROM settings WHERE key_name = ?', [key]);
  const settings = rows as { value: string }[];
  return settings.length > 0 ? settings[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  await pool.execute(
    'INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
    [key, value, value]
  );
}

export interface EmojiRequest {
  id: number;
  user_id: number;
  emoji_id: number;
  vm_node_id: string;
  created_at: Date;
  username?: string;
  emoji_name?: string;
}

export async function logEmojiRequest(userId: number, emojiId: number, vmNodeId: string): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  await pool.execute(
    'INSERT INTO emoji_requests (user_id, emoji_id, vm_node_id) VALUES (?, ?, ?)',
    [userId, emojiId, vmNodeId]
  );
}

export async function getEmojiRequests(limit: number = 100): Promise<EmojiRequest[]> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute(
    `SELECT er.*, u.username, e.name as emoji_name
     FROM emoji_requests er
     LEFT JOIN users u ON er.user_id = u.id
     LEFT JOIN emojis e ON er.emoji_id = e.id
     ORDER BY er.created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows as EmojiRequest[];
}

export async function getAllBlockedDomains(): Promise<string[]> {
  if (!pool) throw new Error('Database not initialized');
  const [rows] = await pool.execute('SELECT domain FROM blocked_domains');
  const domains = rows as { domain: string }[];
  return domains.map(d => d.domain);
}

export async function addBlockedDomain(domain: string): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  try {
    await pool.execute('INSERT INTO blocked_domains (domain) VALUES (?)', [domain]);
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error('Domain already blocked');
    }
    throw error;
  }
}

export async function removeBlockedDomain(domain: string): Promise<void> {
  if (!pool) throw new Error('Database not initialized');
  await pool.execute('DELETE FROM blocked_domains WHERE domain = ?', [domain]);
}

export async function isDomainBlocked(url: string): Promise<boolean> {
  if (!pool) throw new Error('Database not initialized');
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    const blockedDomains = await getAllBlockedDomains();
    return blockedDomains.some(blocked => {
      const blockedLower = blocked.toLowerCase();
      return domain === blockedLower || domain.endsWith('.' + blockedLower);
    });
  } catch (e) {
    return true;
  }
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

