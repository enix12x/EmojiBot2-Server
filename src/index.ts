import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import * as db from './database';
import * as api from './api';

// CollabVM protocol stuff
function encodeGuacArray(arr: string[]): string {
  return arr.map(s => `${Buffer.byteLength(s, 'utf8')}.${s}`).join(',') + ';';
}
function parseGuacArray(msg: string): string[] {
  const arr: string[] = [];
  let i = 0;
  while (i < msg.length) {
    const dot = msg.indexOf('.', i);
    if (dot === -1) break;
    const len = parseInt(msg.substring(i, dot), 10);
    const str = msg.substr(dot + 1, len);
    arr.push(str);
    i = dot + 1 + len;
    if (msg[i] === ',') i++;
    else if (msg[i] === ';') break;
  }
  return arr;
}

interface VMConfig {
  url: string;
  nodeId: string;
  origin?: string;
}
interface Config {
  prefix: string;
  vms: VMConfig[];
  authType: 'password' | 'token';
  adminPassword: string;
  botToken: string;
  loginAs: 'admin' | 'mod';
  username: string;
  colonEmoji?: boolean;
  database: {
    host: string;
    user: string;
    password: string;
    database: string;
    port?: number;
  };
  apiPort: number;
  apiSecret: string;
  apiUrl: string;
}

const configPath = path.resolve(__dirname, '../config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json not found. Please copy config.example.json to config.json and fill it in.');
  process.exit(1);
}
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));


const emojiCache: Map<string, db.Emoji[]> = new Map();

const vmConnections: Map<string, WebSocket> = new Map();

async function loadEmojisForVM(nodeId: string) {
  try {
    const emojis = await db.getEmojisForVM(nodeId);
    emojiCache.set(nodeId, emojis);
    console.log(`[${nodeId}] Loaded ${emojis.length} emojis.`);
  } catch (e) {
    console.error(`[${nodeId}] Failed to load emoji list:`, e);
    emojiCache.set(nodeId, []);
  }
}

async function refreshEmojiCache() {
  for (const vm of config.vms) {
    await loadEmojisForVM(vm.nodeId);
  }
}

async function startBot() {

  await db.initDatabase(config.database);
  

  const vmNodeIds = config.vms.map(vm => vm.nodeId);
  api.startAPI(config.apiPort, vmNodeIds, config.apiSecret);
  

  await refreshEmojiCache();
  
 
  setInterval(refreshEmojiCache, 10000);
  
  (global as any).refreshEmojiCache = refreshEmojiCache;
  
  config.vms.forEach((vm, index) => {
    setTimeout(() => {
      connectToVM(vm);
    }, index * 1000); 
  });
  

  setTimeout(() => {
    api.setVMConnections(vmConnections);
  }, config.vms.length * 1000 + 2000);
}

function connectToVM(vm: VMConfig, retryCount = 0) {
  const maxRetries = 5;
  const retryDelay = 5000;
  const nodeId = vm.nodeId;
  
  if (vmConnections.has(nodeId)) {
    const existingWs = vmConnections.get(nodeId);
    if (existingWs && existingWs.readyState === WebSocket.OPEN) {
      console.log(`[${nodeId}] Already connected, skipping.`);
      return;
    }
  }
  
  const ws = new WebSocket(vm.url, 'guacamole', {
    headers: {
      Origin: vm.origin || 'https://computernewb.com',
    },
  });
  let connected = false;
  let username = config.username;
  let isAdmin = false;
  let myUser: string = config.username;

  ws.on('open', () => {
    console.log(`[${nodeId}] WebSocket opened, requesting username: ${config.username}`);
    connected = true;
    vmConnections.set(nodeId, ws);
    api.setVMConnections(vmConnections);
    ws.send(encodeGuacArray(['rename', config.username]));
  });

  let awaitingAuth = false;
  let awaitingConnect = false;
  ws.on('message', async (data: WebSocket.RawData) => {
    const msg = data.toString();
    const arr = parseGuacArray(msg);
    if (!arr.length) return;
    const opcode = arr[0];
    if (opcode === 'nop') {
      ws.send(encodeGuacArray(['nop']));
    } else if (opcode === 'auth') {
      awaitingAuth = true;
      if (config.authType === 'token') {
        ws.send(encodeGuacArray(['login', config.botToken]));
      } else {
        console.error(`[${nodeId}] Server requires account authentication (bot token). Set authType to "token" and provide a valid botToken in config.`);
        ws.close();
      }
    } else if (opcode === 'list') {
    } else if (opcode === 'rename' && arr[1] === '0') {
      username = arr[3];
      myUser = arr[3];
      if (!awaitingAuth) {
        ws.send(encodeGuacArray(['connect', nodeId]));
      } else {
        awaitingConnect = true;
      }
    } else if (opcode === 'connect' && arr[1] === '1') {
      if (!awaitingAuth && (config.loginAs === 'admin' || config.loginAs === 'mod') && config.authType === 'password') {
        console.log(`[${nodeId}] Logging in as ${config.loginAs}...`);
        ws.send(encodeGuacArray(['admin', '2', config.adminPassword]));
      } else if (awaitingAuth) {
        isAdmin = true; 
      }
    } else if (opcode === 'login') {

      if (arr[1] === '1') {
      if (awaitingConnect) {
          ws.send(encodeGuacArray(['connect', nodeId]));
          awaitingConnect = false;
        }
        isAdmin = true;
        console.log(`[${nodeId}] Logged in with bot token.`);
      } else {
        const errMsg = arr[2] || 'Unknown error';
        console.error(`[${nodeId}] Bot token login failed: ${errMsg}`);
        ws.close();
      }
    } else if (opcode === 'adduser') {
    } else if (opcode === 'rename' && arr[1] === '1') {
    } else if (opcode === 'admin') {
      if (arr[1] === '0') {
        const status = arr[2];
        if (status === '1') {
          console.log(`[${nodeId}] Successfully logged in as Admin`);
          isAdmin = true;
        } else if (status === '3') {
          console.log(`[${nodeId}] Successfully logged in as Moderator`);
          isAdmin = true;
        } else {
          console.error(`[${nodeId}] Admin login failed: ${status}`);
        }
      } else if (arr[1] === '2') {
        const response = arr[2] || '';
        console.log(`[${nodeId}] QEMU monitor response: ${response}`);
      }
    } else if (opcode === 'chat') {
      const sender = arr[1];
      const message = arr[2];
      let isCommand = false;
      if (sender && message) {
        if (message.startsWith(config.prefix)) {
          isCommand = true;
        } else if (config.colonEmoji && /^:([a-zA-Z0-9_]+):/.test(message)) {
          isCommand = true;
        }
        if (isCommand) {
          handleCommand(ws, sender, message, isAdmin, nodeId).catch(err => {
            console.error(`[${nodeId}] Error handling command:`, err);
          });
        }
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[${nodeId}] Disconnected (code: ${code}, reason: ${reason.toString()})`);
    connected = false;
    vmConnections.delete(nodeId);
    api.setVMConnections(vmConnections);
    
    if (code !== 1000 && retryCount < maxRetries) {
      console.log(`[${nodeId}] Attempting to reconnect in ${retryDelay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      setTimeout(() => {
        connectToVM(vm, retryCount + 1);
      }, retryDelay);
    } else if (retryCount >= maxRetries) {
      console.error(`[${nodeId}] Max reconnection attempts reached. Giving up.`);
    }
  });

  ws.on('error', (err: Error) => {
    console.error(`[${nodeId}] WebSocket error:`, err);
  });
}

async function handleCommand(ws: WebSocket, sender: string, message: string, isAdmin: boolean, nodeId: string) {
  let args: string[];
  let cmd: string;
  let colonMatch: RegExpMatchArray | null = null;
  if (config.colonEmoji && (colonMatch = message.match(/^:([a-zA-Z0-9_]+):/))) {
    // :emoji: syntax
    cmd = 'emoji';
    args = ['emoji', colonMatch[1]];
  } else {
    args = message.slice(config.prefix.length).trim().split(/\s+/);
    cmd = args[0].toLowerCase();
  }
  if (cmd === 'help') {
    const html = `<div style='background:#222;color:#fff;padding:8px 12px;border-radius:8px;font-family:sans-serif;'>
      <b>EmojiBot Commands:</b><ul style='margin:4px 0 0 16px;padding:0;'>
        <li><b>${config.prefix}help</b> - Show this help</li>
        <li><b>${config.prefix}emojilist</b> - List available emojis</li>
        <li><b>${config.prefix}emoji &lt;name&gt;</b> - Send an emoji</li>
      </ul>
    </div>`;
    ws.send(encodeGuacArray(['admin', '21', html]));
  } else if (cmd === 'emojilist') {
    const emojiList = emojiCache.get(nodeId) || [];
    if (!emojiList.length) {
      sendChat(ws, 'No emojis available for this VM.');
      return;
    }
    const html = `<div style='background:#222;color:#fff;padding:8px 12px;border-radius:8px;font-family:sans-serif;'>
      <b>Available Emojis:</b>
      <ul style='margin:4px 0 0 16px;padding:0;'>
        ${emojiList.map(e => `<li><b>${e.name}</b>: ${e.description} <img src='${e.web_address}' alt='${e.name}' style='height:20px;vertical-align:middle;'></li>`).join('')}
      </ul>
    </div>`;
    ws.send(encodeGuacArray(['admin', '21', html]));
  } else if (cmd === 'emoji') {
    if (!isAdmin) {
      sendChat(ws, 'Emoji command requires admin/mod.');
      return;
    }
    const name = args[1];
    if (!name) {
      sendChat(ws, `Usage: ${config.prefix}emoji <name>`);
      return;
    }
    const emojiList = emojiCache.get(nodeId) || [];
    const emoji = emojiList.find(e => e.name === name);
    if (!emoji) {
      sendChat(ws, `Emoji not found. Use ${config.prefix}emojilist to see available emojis.`);
      return;
    }
    const html = `<img src='${emoji.web_address}' alt='${emoji.name}' style='height:32px;'>`;
    ws.send(encodeGuacArray(['admin', '21', html]));
    console.log(`[${nodeId}] Sent emoji '${name}' for ${sender}`);
    

    try {
      const user = await db.getUserByUsername(sender);
      if (user) {
        await db.logEmojiRequest(user.id, emoji.id, nodeId);
      }
    } catch (e) {
      console.error('Failed to log emoji request:', e);
    }
  }
}

function sendChat(ws: WebSocket, msg: string) {
  ws.send(encodeGuacArray(['chat', msg]));
}

startBot().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await db.closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await db.closeDatabase();
  process.exit(0);
});
