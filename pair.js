const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const os = require('os');
const { sms, downloadMediaMessage } = require("./msg");
var {
  connectdb,
  input,
  get,
  getalls,
  resetSettings,
} = require("./configdb")
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
	downloadAndSaveMediaMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
	AUTO_READ_MESSAGE: 'true',
	WORK_TYPE: 'public',
	AUTO_RECORDING: 'true',
	ANTI_CALL: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/Gr7fc9xVwp55tl1TH2FmFp?mode=ems_copy_t',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/50qca3.jpg',
    NEWSLETTER_JID: '120363420273361586@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 9999999,
    BOT_FOOTER: '> 𝐃𝐚𝐫𝐤 𝐃𝐫𝐠𝐨𝐧 𝐌𝐢𝐧𝐢 𝐖𝐚 𝐁𝐨𝐭🍁',
    OWNER_NUMBER: '94765684096',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb62FTa3gvWawxQnKF46'
};
const kxq = { key: { remoteJid: "status@broadcast", fromMe: false, id: 'FAKE_META_ID_001', participant: '13135550002@s.whatsapp.net' }, message: { contactMessage: { displayName: '@KX 💡', vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Alip;;;;\nFN:Alip\nTEL;waid=13135550002:+1 313 555 0002\nEND:VCARD` } } };
const adhimini = { key: { remoteJid: "status@broadcast", fromMe: false, id: 'FAKE_META_ID_001', participant: '13135550002@s.whatsapp.net' }, message: { contactMessage: { displayName: 'White dragon🍁🥷', vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Alip;;;;\nFN:Alip\nTEL;waid=13135550002:+1 313 555 0002\nEND:VCARD` } } };
const fakeForward = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363420273361586@newsletter', 
        newsletterName: 'Dark-dragon-mini✨',
        serverMessageId: '115'
    }
};
const newsletterList = require('./newsletter_list.json');

async function loadNewsletterJIDsFromRaw() {
    try {
        return Array.isArray(newsletterList) ? newsletterList : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list:', err.message);
        return [];
    }
		}
const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

// MongoDB Schema
const SessionSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    creds: { type: Object, required: true },
    config: { type: Object },
    updatedAt: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', SessionSchema);

// MongoDB Connection
async function connectMongoDB() {
    try {
        const mongoUri = process.env.MONGO_URI || 'mongodb+srv://fedinolamins_db_user:FT6sPVDTp5jRLIvK@jungii.kc3luzk.mongodb.net/?appName=jungii';
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection failed:', error);
        process.exit(1);
    }
}
connectMongoDB();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function initialize() {
    activeSockets.clear();
    socketCreationTime.clear();
    console.log('Cleared active sockets and creation times on startup');
}

async function autoReconnectOnStartup() {
    try {
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            console.log(`Loaded ${(numbers.length)} numbers from numbers.json`);
        } else {
            console.warn('No numbers.json found, checking MongoDB for sessions...');
        }

        const sessions = await Session.find({}, 'number').lean();
        const mongoNumbers = sessions.map(s => s.number);
        console.log(`Found ${mongoNumbers.length} numbers in MongoDB sessions`);

        numbers = [...new Set([...numbers, ...mongoNumbers])];
        if (numbers.length === 0) {
            console.log('No numbers found in numbers.json or MongoDB, skipping auto-reconnect');
            return;
        }

        console.log(`Attempting to reconnect ${numbers.length} sessions...`);
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                console.log(`Number ${number} already connected, skipping`);
                continue;
            }
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                console.log(`Initiated reconnect for ${number}`);
            } catch (error) {
                console.error(`Failed to reconnect ${number}:`, error);
            }
            await delay(1000);
        }
    } catch (error) {
        console.error('Auto-reconnect on startup failed:', error);
    }
}

initialize();
setTimeout(autoReconnectOnStartup, 5000);

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

//////////======= Connect msg //////=========
async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
   const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
       : `Failed to join group: ${groupResult.error}`;
   const caption = formatMessage(
       '*Connected Successful White dragon-Mini✅*',
        ` ❗Number: ${number}\n 🧚‍♂️ Status: Online`,
     `${config.BOT_FOOTER}`
   );

  for (const admin of admins) {
       try {
          await socket.sendMessage(
             `${admin}@s.whatsapp.net`,
               {
                  image: { url: config.RCD_IMAGE_PATH },
                  caption
               }
            );
      } catch (error) {
           //console.error(`Failed to send connect message to admin ${admin}:`, error);
    }
   }
 }
////////////////============ kkkkkkkkkkkkkkkk//////========

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '© ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴛʜᴇ ꜱᴏʟᴏ ʟᴇᴠᴇʟɪɴɢ x  📌'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

async function updateAboutStatus(socket) {
    try {
        // About status update logic here
        console.log('About status updated successfully');
    } catch (error) {
        console.error('Error updating about status:', error);
    }
}

async function updateStoryStatus(socket) {
    try {
        // Story status update logic here
        console.log('Story status updated successfully');
    } catch (error) {
        console.error('Error updating story status:', error);
    }
}

function setupNewsletterHandlers(socket) {
    const newsletterJid = "120363420273361586@newsletter"; 

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const jid = message.key.remoteJid;
        if (jid !== newsletterJid) return; 

        try {
            const emojis = ['💗', '❤️', '💙', '💜', '💛'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}
async function loadConfig(number) {
    try {
        const settings = await getalls(number); 
        if (settings) {
            Object.assign(config, settings);
        } else {
            console.warn(`No settings found for number: ${number}`);
        }
    } catch (error) {
        console.error('Error loading config:', error);
}
}
async function downloadAndSaveMedia(message, mediaType) {
try {
const stream = await downloadContentFromMessage(message, mediaType);
let buffer = Buffer.from([]);

for await (const chunk of stream) {
buffer = Buffer.concat([buffer, chunk]);
}

return buffer;
} catch (error) {
//console.error('Download Media Error:', error);
throw error;
}
}
async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
           
             if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}


async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '© ᴘᴏᴡᴇʀᴇᴅ ᴡʜɪᴛᴇ ᴅʀᴀɢᴏɴ ᴍɪɴɪ 📌'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}
async function oneViewmeg(socket, isOwner, msg ,sender) {
    if (isOwner) {  
    try {
    const akuru = sender
    const quot = msg
    if (quot) {
        if (quot.imageMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
            await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
        } else if (quot.videoMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
             await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
        } else if (quot.audioMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.audioMessage?.caption || "";
            let anu = await socke.downloadAndSaveMediaMessage(quot.audioMessage);
             await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        } else if (quot.viewOnceMessageV2?.message?.imageMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
             await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
            
        } else if (quot.viewOnceMessageV2?.message?.videoMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });

        } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
        
            let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        }
        }        
        } catch (error) {
      }
    }

}

const handleSettingUpdate = async (settingType, newValue, reply, number) => {
  const currentValue = await get(settingType, number);
  var alreadyMsg = "*This setting alredy updated !*";
  if (currentValue === newValue) {
    return await reply(alreadyMsg);
  }
  await input(settingType, newValue, number);
  await reply(`➟ *${settingType.replace(/_/g, " ").toUpperCase()} updated: ${newValue}*`);
};

const updateSetting = async (settingType, newValue, reply, number) => {
  const currentValue = await get(settingType, number);
  if (currentValue === newValue) {
   var alreadyMsg = "*This setting alredy updated !*";
    return await reply(alreadyMsg);
  }
  await input(settingType, newValue, number);
  await reply(`➟ *${settingType.replace(/_/g, " ").toUpperCase()} updated: ${newValue}*`);
};
function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
loadConfig(number).catch(console.error);
const type = getContentType(msg.message);
    if (!msg.message) return	
  msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
	const m = sms(socket, msg);
	const quoted =
        type == "extendedTextMessage" &&
        msg.message.extendedTextMessage.contextInfo != null
          ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
          : []
        const body = (type === 'conversation') ? msg.message.conversation 
    : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
        ? msg.message.extendedTextMessage.text 
    : (type == 'interactiveResponseMessage') 
        ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
            && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
    : (type == 'templateButtonReplyMessage') 
        ? msg.message.templateButtonReplyMessage?.selectedId 
    : (type === 'extendedTextMessage') 
        ? msg.message.extendedTextMessage.text 
    : (type == 'imageMessage') && msg.message.imageMessage.caption 
        ? msg.message.imageMessage.caption 
    : (type == 'videoMessage') && msg.message.videoMessage.caption 
        ? msg.message.videoMessage.caption 
    : (type == 'buttonsResponseMessage') 
        ? msg.message.buttonsResponseMessage?.selectedButtonId 
    : (type == 'listResponseMessage') 
        ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
    : (type == 'messageContextInfo') 
        ? (msg.message.buttonsResponseMessage?.selectedButtonId 
            || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            || msg.text) 
    : (type === 'viewOnceMessage') 
        ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
    : (type === "viewOnceMessageV2") 
        ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") 
    : '';
	 	let sender = msg.key.remoteJid;
	  const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid)
          const senderNumber = nowsender.split('@')[0]
          const developers = `${config.OWNER_NUMBER}`;
          const botNumber = socket.user.id.split(':')[0]
          const isbot = botNumber.includes(senderNumber)
          const isOwner = isbot ? isbot : developers.includes(senderNumber)
          var prefix = config.PREFIX
	  var isCmd = body.startsWith(prefix)
    	  const from = msg.key.remoteJid;
          const isGroup = from.endsWith("@g.us")
	      const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
          var args = body.trim().split(/ +/).slice(1)
	  const reply = async(teks) => {
             return await socket.sendMessage(sender, { text: teks }, { quoted: msg })
          }
	 // settings tika
            const presence = config.PRESENCE;
            if (msg.key.remoteJid) {
                if (presence && presence !== "available") {
                    await socket.sendPresenceUpdate(presence, msg.key.remoteJid);
                } else {
                    await socket.sendPresenceUpdate("available", msg.key.remoteJid);
                }
            }
            if (config.AUTO_READ_MESSAGE === "cmd" && isCmd) {
                await socket.readMessages([msg.key]);
            } else if (config.AUTO_READ_MESSAGE === "all") {
                await socket.readMessages([msg.key]);
            }

            if (!isOwner && config.WORK_TYPE === "private") return;
            if (!isOwner && isGroup && config.WORK_TYPE === "inbox") return;
            if (!isOwner && !isGroup && config.WORK_TYPE === "groups") return;
socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
                let quoted = message.msg ? message.msg : message
                let mime = (message.msg || message).mimetype || ''
                let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
                const stream = await downloadContentFromMessage(quoted, messageType)
                let buffer = Buffer.from([])
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }
                let type = await FileType.fromBuffer(buffer)
                trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
                await fs.writeFileSync(trueFileName, buffer)
                return trueFileName
}
        if (!command) return;
        
        let pinterestCache = {}; //

        try {
switch (command) {
                           case 'button': {
const buttons = [
    {
        buttonId: `${config.PREFIX}menu`,
        buttonText: { displayText: 'MENU' },
        type: 1
    },
    {
        buttonId: `${config.PREFIX}alive`,
        buttonText: { displayText: 'Alive' },
        type: 1
    }
];

const captionText = '𝙒𝙝𝙞𝙩𝙚 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩';
const footerText = '*ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴠɪꜱʜᴡᴀ ᴏꜰᴄ*';

const buttonMessage = {
    image: { url: "https://files.catbox.moe/50qca3.jpg" },
    caption: captionText,
    footer: footerText,
    buttons,
    headerType: 1
};

socket.sendMessage(from, buttonMessage, { quoted: msg });

    break;
}
       case 'alive': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const channelStatus = config.NEWSLETTER_JID ? '✅ Followed' : '❌ Not followed';

    const captionText = `
*_____________________________________*
*│* 🍁ʙᴏᴛ ɴᴀᴍᴇ: White Dragon-Mini V1
*│* 🥷ᴏᴡɴᴇʀ : Vishwa Ofc
│
╭─── 〘*Ｓｅｓｓｉｏｎ ｉｎｆｏ*〙─────────
│ ⏰ Bot Uptime: ${hours}h ${minutes}m ${seconds}s
  🟢 Active session: ${activeSockets.size}
│ 📞 Your Number: ${number}
│ 📢 Channel: ${channelStatus}
│
╭─── 〘 🛠️ COMMANDS 〙 ────────────
│
📌 ${config.PREFIX}menu  -  Watch all command
📌 ${config.PREFIX}ping   - Bot life testing
📌 ${config.PREFIX}status - Latest updates
📌 ${config.PREFIX}owner - Bot developed
📌 ${config.PREFIX}runtime - Total runtime
📌 ${config.PREFIX}ping - Ping test
*╭───------------------------------------*
│ 🔗 *ꜰʀᴇᴇ ʙᴏᴛ ᴅᴇᴘʟᴏʏ ꜱɪᴛᴇ*🥷:
│ https://Dark-dragon-mini.vercel.app/
*╰────────────────────────────────*
`;

    const templateButtons = [
        {
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: 'MENU' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}owner`,
            buttonText: { displayText: 'OWNER' },
            type: 1,
        },
        {
            buttonId: 'action',
            buttonText: {
                displayText: '📂 Menu Options'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'Click Here ❏',
                    sections: [
                        {
                            title: `𝙒𝙝𝙞𝙩𝙚 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: 'BOT MENU🍁',
                                    description: '𝙒𝙝𝙞𝙩𝙚 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}menu`,
                                },
                                {
                                    title: 'CONTACT OWNER🍁',
                                    description: '𝙒𝙝𝙞𝙩𝙚 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}owner`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://files.catbox.moe/50qca3.jpg" },
        caption: `*ʜᴇʏ ᴡʜɪᴛᴇ ᴅʀᴀɢᴏɴ-ᴍɪɴɪ ʙᴏᴛ ᴀʟɪᴠᴇ ɴᴏᴡ🥷*\n\n${captionText}`,
    }, { quoted: msg });

    break;
}
                case 'menu': {
    
    const captionText = `
*©ᴍᴀᴅᴇ ʙʏ ᴠɪꜱʜᴡᴀ ᴏꜰᴄ & ʙᴀᴅʙᴏʏ*\n\n┏━━━━━━━━━━➢\n*ᴘʟᴀᴛꜰᴏʀᴍ-ʜᴇʀᴏᴋᴜ*\n*ᴠᴇʀꜱɪᴏɴ-1.00*\n*ᴛʏᴘᴇ-ᴡᴀ ᴍɪɴɪ ʙᴏᴛ*\n┗━━━━━━━━━━➢\n┇ *\`${config.PREFIX}alive\`*\n┋ • Show bot status\n┋\n┋ *\`${config.PREFIX}Song\`*\n┋ • Downlode Songs\n┋\n┋ *\`${config.PREFIX}getdp\`*\n┋ • Get User Profile Picture\n┋\n┋ *\`${config.PREFIX}chid\`*\n┋ • Get any chanel newsletters\n┋\n┋ *\`${config.PREFIX}logo\`*\n┋ • Create Logo\n┋\n┋ *\`${config.PREFIX}csong\`*\n┋ • Upload channel songs\n┋\n┋ *\`${config.PREFIX}tiktok\`*\n┋ • Downlode tiktok video\n┋\n┋ *\`${config.PREFIX}fb\`*\n┋ • Downlode facebook video\n┋\n┋ *\`${config.PREFIX}ig\`*\n┋ • Downlode instagram video\n┋\n┋ *\`${config.PREFIX}chi\`*\n┋ • channel details get\n┋\n┋ *\`${config.PREFIX}wiki\`*\n┋ • View latest wiki news update\n┋\n┋ *\`${config.PREFIX}apk\`*\n┋ • Download Apk\n┋\n┋ \`${config.PREFIX}fc\`\n┇ • Follow channel\n┇\n┇ *\`${config.PREFIX}bomb\`*\n┇• Send Bomb Massage\n┋\n┋ *\`${config.PREFIX}pair\`*\n┋ • Get Pair Code\n┇\n┇ *\`${config.PREFIX}deleteme\`*\n┇• Delete your session\n┋\n┗━━━━━━━━━━━ ◉◉➣\n\n*▫️ꜰʀᴇᴇ ᴅᴇᴘʟᴏʏ ᴡʜɪᴛᴇ ᴅʀᴀɢᴏɴ-ᴍɪɴɪ ʙᴏᴛ🖇️🍁*\n> https://White-dragon.vercel.app/
`;

    const templateButtons = [
        {
            buttonId: `${config.PREFIX}alive`,
            buttonText: { displayText: 'ALIVE' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}setting`,
            buttonText: { displayText: 'SETTING' },
            type: 1,
        },
        {
            buttonId: 'action',
            buttonText: {
                displayText: '📂 Menu Options'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'Click Here ❏',
                    sections: [
                        {
                            title: `𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: 'CHECK BOT ALIVE',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}alive`,
                                },
                                {
                                    title: 'BOT OWNERS',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}owner`,
                                },
                                {
                                    title: 'SONG DOWNLOD',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}song`,
                                },
                                {
                                    title: 'WHATSAPP PROFILE',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}getdp`,
                                },
                                {
                                    title: 'CHANNEL SONGS',
                                    description: '𝘿𝙖𝙧𝙠 𝙙𝙧𝙖𝙜𝙤𝙣 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}csong`,
                                },
                                {
                                    title: 'IMAGE DOWNLOD',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}img`,
                                },
                                {
                                    title: 'LOGO CREATE',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}logo`,
                                },
                                {
                                    title: 'CHANNEL INFO',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}chid`,
                                },
                                {
                                    title: 'TIKTOK VIDEO',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}tiktok`,
                                },
                                {
                                    title: 'FACBOOK VIDEO',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}fb`,
                                },
                                {
                                    title: 'INSTAGRAM VIDEO',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}ig`,
                                },
                                {
                                    title: 'TIKTOK SEARCH',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}tiks`,
                                },
                                {
                                    title: 'DOWNLOAD APK',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}ai`,
                                },
                                 {
                                    title: 'VIEW ONCE MASSAGE ',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}vv`,
                                },
                                {
                                    title: 'DOWNLODE STATUS',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}send`,
                                },
                                {
                                    title: 'WIKI NEWS',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}wikj`,
                                },
                                
                                {
                                    title: 'BOMB MASSAGE ',
                                    description: '𝘿𝙖𝙧𝙠 𝘿𝙧𝙖𝙜𝙤𝙣 𝙈𝙞𝙣𝙞 𝘽𝙤𝙩',
                                    id: `${config.PREFIX}boom`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://files.catbox.moe/50qca3.jpg" },
        caption: `*𝐃𝐀𝐑𝐊-𝐃𝐑𝐀𝐆𝐎𝐍-𝐌𝐈𝐍𝐈* \n${captionText}`,
    }, { quoted: msg }, { quoted: kxq });

    break;
}   
		case 'chid': {
                    try {
                        if (!isOwner) return await reply('🚫 Only owner can use this command.');
                        if (!args[0]) return await reply('ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴄʜᴀɴɴᴇʟ ᴜʀʟ.\nᴇx: https://whatsapp.com/channel/1234567890');

                        const match = args[0].match(/https:\/\/whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/i);
                        if (!match) return await reply('ɪɴᴠᴀʟɪᴅ ᴄʜᴀɴɴᴇʟ ᴜʀʟ.\nᴇx: https://whatsapp.com/channel/1234567890');

                        const channelId = match[1];
                        const channelMeta = await socket.newsletterMetadata("invite", channelId);
                        
                        await reply(`${channelMeta.id}`);
                    } catch (e) {
                        await reply(boterr);
                    }
                }
                break;
		        case 'owner': {
  await socket.sendMessage(sender, { 
        react: { 
            text: "👤",
            key: msg.key 
        } 
    });
    
  // Owner's contact information
  const ownerContact = {
  contacts: {
    displayName: 'My Contacts',
    contacts: [
      {
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:VishwaOFC\nTEL;TYPE=Coder,VOICE:94765684096\nEND:VCARD',
      },
      {
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:Vishwat\nTEL;TYPE=Coder,VOICE:94775947579\nEND:VCARD',
      },
    ],
  },
};

  // Owner's location information (optional)
  const ownerLocation = {
  location: {
    degreesLatitude: 37.7749,
    degreesLongitude: -122.4194,
    name: 'dark dragon Address',
    address: 'Nuwaraeliya, SriLanka',
  },
};

  // Send contact message
  await socket.sendMessage(sender, ownerContact);
  
  // Send location message
  await socket.sendMessage(sender, ownerLocation);
  break;
					}
		
		case 'tourl': {
    const axios = require('axios');
    const FormData = require('form-data');
    
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';
    
    const validExpiry = ['1h', '12h', '24h', '72h'];
    const expiry = validExpiry.includes(q.trim()) ? q.trim() : '24h';
    
    try {
        let buffer = null;
        let mimetype = null;
        let filename = 'file';
        
        if (msg.message?.imageMessage) {
            buffer = await downloadMediaMessage(msg, 'buffer');
            mimetype = msg.message.imageMessage.mimetype || 'image/jpeg';
            filename = 'image.jpg';
        } else if (msg.message?.videoMessage) {
            buffer = await downloadMediaMessage(msg, 'buffer');
            mimetype = msg.message.videoMessage.mimetype || 'video/mp4';
            filename = 'video.mp4';
        } else if (msg.message?.audioMessage) {
            buffer = await downloadMediaMessage(msg, 'buffer');
            mimetype = msg.message.audioMessage.mimetype || 'audio/mpeg';
            filename = 'audio.mp3';
        } else if (msg.message?.documentMessage) {
            buffer = await downloadMediaMessage(msg, 'buffer');
            mimetype = msg.message.documentMessage.mimetype || 'application/octet-stream';
            filename = msg.message.documentMessage.fileName || 'document';
        } else if (msg.message?.stickerMessage) {
            buffer = await downloadMediaMessage(msg, 'buffer');
            mimetype = msg.message.stickerMessage.mimetype || 'image/webp';
            filename = 'sticker.webp';
        } else {
            return await socket.sendMessage(sender, { 
                text: `*𝙲𝚊𝚝𝚋𝚘𝚡 𝚄𝚙𝚕𝚘𝚊𝚍𝚎𝚛*\n\n*Usage:*\n• Send media with caption: \`1h\`, \`12h\`, \`24h\`, or \`72h\` for temporary upload\n• Send media without caption for permanent upload\n\n*Supported:* Images, Videos, Audio, Documents, Stickers` 
            });
        }
        
        if (!buffer) {
            return await socket.sendMessage(sender, { 
                text: '*`Failed to download media`*' 
            });
        }
        
        const fileSizeMB = buffer.length / 1024 / 1024;
        if (fileSizeMB > 200) {
            return await socket.sendMessage(sender, { 
                text: `*\`File too large (${fileSizeMB.toFixed(2)} MB). Maximum size is 200MB\`*` 
            });
        }
        
        await socket.sendMessage(sender, { 
            text: `*\`Uploading to ${q.trim() && validExpiry.includes(q.trim()) ? 'Litterbox (temporary)' : 'Catbox (permanent)'}, please wait...\`*` 
        });
        
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        
        if (q.trim() && validExpiry.includes(q.trim())) {
            form.append('time', expiry);
        }
        
        form.append('fileToUpload', buffer, {
            filename: filename,
            contentType: mimetype
        });
        
        const apiUrl = q.trim() && validExpiry.includes(q.trim()) 
            ? 'https://litterbox.catbox.moe/resources/internals/api.php'
            : 'https://catbox.moe/user/api.php';
        
        const response = await axios({
            url: apiUrl,
            method: 'POST',
            data: form,
            headers: {
                ...form.getHeaders()
            },
            timeout: 60000
        });
        
        if (response.data && response.data.startsWith('https://')) {
            const fileSize = fileSizeMB.toFixed(2);
            const uploadInfo = `
📤 *𝙲𝚊𝚝𝚋𝚘𝚡 𝚄𝚙𝚕𝚘𝚊𝚍 𝚂𝚞𝚌𝚌𝚎𝚜𝚜* 📤

📁 *𝙵𝚒𝚕𝚎𝚗𝚊𝚖𝚎:* \`${filename}\`
📊 *𝚂𝚒𝚣𝚎:* \`${fileSize} MB\`
📝 *𝚃𝚢𝚙𝚎:* \`${mimetype}\`
⏰ *𝚂𝚝𝚘𝚛𝚊𝚐𝚎:* \`${q.trim() && validExpiry.includes(q.trim()) ? `Temporary (${expiry})` : 'Permanent'}\`

🔗 *𝚄𝚁𝙻:* ${response.data}

> *© ᴅᴀʀᴋ-ᴅʀᴀɢᴏɴ-ᴍɪɴɪ-ʙᴏᴛ*
`;
            await socket.sendMessage(sender, { text: uploadInfo });
        } else {
            await socket.sendMessage(sender, { 
                text: '*`Upload failed. Please try again later`*' 
            });
        }
        
    } catch (error) {
        console.error('Catbox upload error:', error);
        await socket.sendMessage(sender, { 
            text: `*\`Error: ${error.message || 'Failed to upload file'}\`*` 
        });
    }
    break;
		}
		const NEW_FB_API = 'https://tcs-demonic2.vercel.app/api/fbdownloader'; // Define the new base URL once

case 'fb':
case 'fbdl':
case 'facebook': {
  try {
    const fbUrl = args[0];
    if (!fbUrl) return reply('*Please provide a Facebook video or reel URL..*');

    // --- API URL CHANGE ---
    const apiUrl = `${NEW_FB_API}?url=${encodeURIComponent(fbUrl)}`;
    const { data: apiRes } = await axios.get(apiUrl);

    if (!apiRes?.urls || Object.keys(apiRes.urls).length === 0) {
      return reply('*❌ Invalid or unsupported Facebook video URL or API error.*');
    }

    const thumb = apiRes.thumb || config.RCD_IMAGE_PATH;

    await socket.sendMessage(sender, {
      image: { url: thumb },
      caption: `✅ *${apiRes.title || 'Facebook Video'}*\n\nChoose your download option below 👇`,
      buttons: [
        { buttonId: `${config.PREFIX}fbdoc ${fbUrl}`, buttonText: { displayText: '📄 DOCUMENT' }, type: 1 },
        { buttonId: `${config.PREFIX}fbsd ${fbUrl}`, buttonText: { displayText: '📹 SD 360p' }, type: 1 },
        { buttonId: `${config.PREFIX}fbhd ${fbUrl}`, buttonText: { displayText: '🎥 HD 720p' }, type: 1 },
      ],
    }, { quoted: adhimini });

  } catch (error) {
    console.error(error);
    reply('❌ Unable to fetch Facebook video. Please try again later.');
  }
  break;
}

// 📄 FB DOC
case 'fbdoc': {
  try {
    const fbUrl = args[0];
    if (!fbUrl) return reply("*ඔයාලා වීඩීයෝව බාගත කරන්න URL එකක් දෙන්න...!*");

    // --- API URL CHANGE ---
    const api = `${NEW_FB_API}?url=${encodeURIComponent(fbUrl)}`;
    const { data: apiRes } = await axios.get(api);

    // Assuming the new API returns HD and SD URLs directly under apiRes.urls
    const hdUrl = apiRes?.urls?.hd || apiRes?.urls?.sd; 
    if (!hdUrl) return reply("❌ වීඩීයෝව බාගත කළ නොහැක. වෙනත් එකක් උත්සහ කරන්න!");

    await socket.sendMessage(sender, {
      document: { url: hdUrl },
      mimetype: "video/mp4",
      fileName: `${apiRes.title || 'facebook_video'}.mp4`
    });

  } catch (e) {
    console.error(e);
    reply(`*ඇතැම් දෝෂයකි!*\n\`\`\`${e.message}\`\`\``);
  }
  break;
}

case 'fbsd': {
  try {
    const fbUrl = args[0];
    if (!fbUrl) return reply("*URL එකක් දෙන්න...!*");

    // --- API URL CHANGE ---
    const api = `${NEW_FB_API}?url=${encodeURIComponent(fbUrl)}`;
    const { data: apiRes } = await axios.get(api);

    const sdUrl = apiRes?.urls?.sd; // Assuming SD URL is under apiRes.urls.sd
    if (!sdUrl) return reply("❌ SD version not available!");

    await socket.sendMessage(sender, {
      video: { url: sdUrl },
      mimetype: "video/mp4",
      caption: `✅ Video Download Success! (SD)`
    });

  } catch (e) {
    console.error(e);
    reply(`*ඇතැම් දෝෂයකි!*\n\`\`\`${e.message}\`\`\``);
  }
  break;
}

case 'fbhd': {
  try {
    const fbUrl = args[0];
    if (!fbUrl) return reply("*URL එකක් දෙන්න...!*");

    // --- API URL CHANGE ---
    const api = `${NEW_FB_API}?url=${encodeURIComponent(fbUrl)}`;
    const { data: apiRes } = await axios.get(api);

    const hdUrl = apiRes?.urls?.hd; // Assuming HD URL is under apiRes.urls.hd
    if (!hdUrl) return reply("❌ HD version not available!");

    await socket.sendMessage(sender, {
      video: { url: hdUrl },
      mimetype: "video/mp4",
      caption: `✅ Video Download Success! (HD)`
    });

  } catch (e) {
    console.error(e);
    reply(`*ඇතැම් දෝෂයකි!*\n\`\`\`${e.message}\`\`\``);
  }
  break;
		}
		    
      

		case 'tiktok':
case 'ttdl':
case 'tiktokdl': {
    const axios = require('axios');

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Please provide a TikTok video link`*' });
    }

    const ttUrl = q.trim();

    if (!/tiktok\.com/.test(ttUrl)) {
        return await socket.sendMessage(sender, { text: '*`Invalid TikTok link`*' });
    }

    try {
        await socket.sendMessage(sender, { text: '*`Fetching video details, please wait...`*' });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(ttUrl)}`;
        const { data } = await axios.get(apiUrl, { timeout: 20000 });

        if (!data?.status || !data?.data) {
            return await socket.sendMessage(sender, { text: '*`Failed to fetch TikTok video details`*' });
        }

        const { title, like, comment, share, author, meta } = data.data;
        const media = meta?.media || [];
        const video = media.find(v => v.type === 'video');
        const videoUrl = video?.org || video?.url || video?.play;
        
        if (!videoUrl) {
            return await socket.sendMessage(sender, { text: '*`Could not find downloadable video stream`*' });
        }

        const desc = `
🎵 *𝚃𝚒𝚔𝚃𝚘𝚔 𝚅𝚒𝚍𝚎𝚘* 🎵

👤 *𝚄𝚜𝚎𝚛 :* \`${author?.nickname || '-'}\` (@${author?.username || '-'})
📖 *𝚃𝚒𝚝𝚕𝚎 :* \`${title || '-'}\`

👍 *𝙻𝚒𝚔𝚎𝚜* : ${like || 0}
💬 *𝙲𝚘𝚖𝚖𝚎𝚗𝚝𝚜* : ${comment || 0}
🔁 *𝚂𝚑𝚊𝚛𝚎𝚜* : ${share || 0}

> *© ᴅᴀʀᴋ ᴅʀᴀɢᴏɴ-ᴍɪɴɪ ʙᴏᴛ*
`;

        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });

        // Send the video directly as the default response
        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: desc,
        }, { quoted: msg });

        // Optional: Add a button for document download (similar to FB)
        await socket.sendMessage(sender, {
            text: 'Choose a different download option:',
            buttons: [
                { buttonId: `${config.PREFIX}ttdoc ${ttUrl}`, buttonText: { displayText: '📄 DOWNLOAD AS DOCUMENT' }, type: 1 },
            ],
        }, { quoted: msg });


        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('Error in TikTok downloader:', err);
        await socket.sendMessage(sender, { text: '*`Error occurred while downloading TikTok video`*' });
    }

    break;
}

// 📄 TIKTOK DOCUMENT DOWNLOAD
case 'ttdoc': {
    const axios = require('axios');
    try {
        const ttUrl = args[0];
        if (!ttUrl) return reply("*Please provide a TikTok video URL!*"); // Using the 'reply' function placeholder

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(ttUrl)}`;
        const { data } = await axios.get(apiUrl, { timeout: 20000 });

        if (!data?.status || !data?.data) {
            return reply('*`Failed to fetch TikTok video details for document download`*');
        }

        const { title, meta } = data.data;
        const media = meta?.media || [];
        const video = media.find(v => v.type === 'video');
        const videoUrl = video?.org || video?.url || video?.play;

        if (!videoUrl) {
            return reply('*`Could not find video stream for document download`*');
        }

        await socket.sendMessage(sender, {
            document: { url: videoUrl },
            mimetype: "video/mp4",
            fileName: `${title || 'tiktok_video'}.mp4`,
            caption: `✅ *Document Download Success!*\nTitle: ${title || '-'}`
        });

    } catch (e) {
        console.error('Error in TikTok document downloader:', e);
        reply(`*An error occurred!*\n\`\`\`${e.message}\`\`\``); // Using the 'reply' function placeholder
    }
    break;
		   }
		case "fb": {
    let url = text.trim();
    let mentionedJid = null;

    // Check if it's a reply in a group
    if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage && m.key.remoteJid.endsWith('@g.us')) {
        mentionedJid = m.message.extendedTextMessage.contextInfo.participant;
        if (!url && m.message.extendedTextMessage.contextInfo.quotedMessage.conversation) {
            url = m.message.extendedTextMessage.contextInfo.quotedMessage.conversation.trim();
        }
    }

    // Validate URL
    if (!url) {
        return reply(`📌 *Usage:* ${prefix + command} <Facebook URL>\nExample: ${prefix + command} https://fb.watch/xyz\nOr reply to a message containing a Facebook URL with .fb`);
    }

    if (!url.includes('facebook.com') && !url.includes('fb.watch')) {
        return reply('❌ Invalid URL - Must be from Facebook (facebook.com or fb.watch)');
    }

    try {
        // Notify user that processing has started
        await reply('⏳ Processing your Facebook video...');

        // Fetch video links from API
        const apiURL = `https://tcs-demonic2.vercel.app/api/fbdownloader?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiURL);
        const data = await response.json();

        if (!data.success || !data.data.success) {
            throw new Error(data.message || "Failed to fetch video links.");
        }

        const { hdlink, sdlink } = data.data;

        // Try to download and send video (prefer HD)
        let videoUrl = hdlink || sdlink;
        if (videoUrl) {
            // Fetch video as buffer
            const videoResponse = await fetch(videoUrl);
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

            // Check file size (WhatsApp limit ~100MB)
            const fileSizeMB = videoBuffer.length / (1024 * 1024);
            if (fileSizeMB <= 100) {
                await socket.sendMessage(m.chat, {
                    video: videoBuffer,
                    caption: `🎥 *Facebook Video Downloaded!*\nQuality: ${hdlink ? 'HD' : 'SD'}\nURL: ${url}`,
                    contextInfo: {
                        mentionedJid: mentionedJid ? [mentionedJid, m.sender] : [m.sender],
                        forwardedNewsletterMessageInfo: {
                            newsletterName: "Dark dragon bot",
                            newsletterJid: "1203630114292114@newsletter"
                        },
                        isForwarded: true,
                        externalAdReply: {
                            title: "Dark dragon mini",
                            thumbnailUrl: 'https://files.catbox.moe/ypeipb.jpg',
                            sourceUrl: "https://whatsapp.com/channel/0029Vb2pM1NCrUCy9Q0f3C"
                        }
                    }
                }, { quoted: msg });
            } else {
                // Send links if video is too large
                let message = `⚠ Video too large to send (${fileSizeMB.toFixed(2)} MB)!\n\n🎥 *Facebook Video Links:*\n`;
                if (hdlink) message += `📽 *HD*: ${hdlink}\n`;
                if (sdlink) message += `📽 *SD*: ${sdlink}\n`;
                message += `\nURL: ${url}`;
                await reply(message);
            }
        } else {
            throw new Error("No video links available.");
        }

        // Success notification
        await reply('✅ Video processed successfully!');
    } catch (error) {
        console.error("FB Downloader Error:", error);
        await reply(`❌ *Error:* ${error.message || "Failed to download video. Please try again."}`);
    }}
    break;

                case 'fc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 1203634017639074@newsletter'
                        });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
                        });
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `📌 Already following the channel:\n${jid}`
                            });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    break;
                }
		case 'song': case 'yta': {
                    try {
                        const q = args.join(" ");
                        if (!q) {
                            return reply("🚫 Please provide a search query.");
                        }

                        let ytUrl;
                        if (q.includes("youtube.com") || q.includes("youtu.be")) {
                            ytUrl = q;
                        } else {
                            const search = await yts(q);

                            if (!search.videos.length) {
                                return reply("🚫 No results found.");
                            }
                            ytUrl = search.videos[0].url;
                        }

                        const api = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(ytUrl)}&format=mp3&apikey=sadiya`;
                        const { data: apiRes } = await axios.get(api);

                        if (!apiRes?.status || !apiRes.result?.download) {
                            return reply("🚫 Something went wrong.");
                        }

                        const result = apiRes.result;

                        const caption = `*ℹ️ Title :* \`${result.title}\`\n*⏱️ Duration :* \`${result.duration}\`\n*🧬 Views :* \`${result.views}\`\n*📅 *Released Date :* \`${result.publish}\``;

                        await socket.sendMessage(sender, { image: { url: result.thumbnail }, caption: caption }, { quoted: msg });
                        await socket.sendMessage(sender, { audio: { url: result.download }, mimetype: "audio/mpeg", ptt: false }, { quoted: msg });
                    } catch (e) {
                         reply("🚫 Something went wrong.");
                    }
                }
                break;
                case 'pair': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair +9476066XXXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://white-dragon-mini.onrender.com/?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("🌐 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `> *ᴅᴀʀᴋ ᴅʀᴀɢᴏɴ 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃 𝙿𝙰𝙸𝚁 𝙲𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝚃𝙴𝙳* ✅\n\n*🔑 Your pairing code is:* ${result.code}`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    break;
}
		


		case 'vv': {
try {
if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
return reply("Please reply to a ViewOnce message.");
}

const quotedMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
let ext, mediaType;

if (quotedMsg.imageMessage) {
ext = "jpg";
mediaType = "image";
} else if (quotedMsg.videoMessage) {
ext = "mp4";
mediaType = "video";
} else if (quotedMsg.audioMessage) {
ext = "mp3";
mediaType = "audio";
} else {
return reply("Unsupported media type. Please reply to an image, video, or audio message.");
}

const stream = await downloadContentFromMessage(
quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage,
mediaType
);

let buffer = Buffer.from([]);
for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

if (mediaType === "image") {
await socket.sendMessage(sender, { 
image: buffer, 
contextInfo: fakeForward,
}, { quoted: adhimini });
} else if (mediaType === "video") {
await socket.sendMessage(sender, { 
video: buffer,  
contextInfo: fakeForward,
}, { quoted: adhimini });
} else if (mediaType === "audio") {
await socket.sendMessage(sender, { 
audio: buffer, 
mimetype: quotedMsg.audioMessage.mimetype || "audio/mpeg",
contextInfo: fakeForward,
}, { quoted: adhimini });
}

} catch (e) {
//   console.error("Error:", e);
reply("An error occurred while fetching the ViewOnce message.");
}
break;
					}
             
             


		
case 'csend':
case 'csong': {
  try {
	  if (!isOwner) {
      return await reply("🚫 *You are not authorized to use this command!*");
    }
    
    const q = args.join(" ");
    if (!q) {
      return reply("*ඔයාලා ගීත නමක් හෝ YouTube ලින්ක් එකක් දෙන්න...!*");
    }

    await socket.sendMessage(msg.key.remoteJid, {
      react: {
        text: "🎧",
        key: msg.key
      }
    });

    const targetJid = args[0];
    const query = args.slice(1).join(" ");

    if (!targetJid || !query) {
      return reply("*❌ Format එක වැරදියි! Use:* `.csong <jid> <song name>`");
    }

    const yts = require("yt-search");
    const search = await yts(query);

    if (!search?.videos?.length) {
      return reply("*ගීතය හමුනොවුණා... ❌*");
    }

    const data = search.videos[0];
    const ytUrl = data.url;
    const ago = data.ago;

    const axios = require("axios");
    const api = `https://api-dark-shan-yt.koyeb.app/download/ytmp3?url=${ytUrl}&apikey=ef045779083dbcee`;
    const { data: apiRes } = await axios.get(api);

    if (!apiRes?.status || !apiRes?.data?.download) {
      return reply("❌ ගීතය බාගත කළ නොහැක. වෙනත් එකක් උත්සහ කරන්න!");
    }

    const result = apiRes.data;

    const fs = require("fs");
    const path = require("path");
    const ffmpeg = require("fluent-ffmpeg");
    const ffmpegPath = require("ffmpeg-static");
    ffmpeg.setFfmpegPath(ffmpegPath);

    const tempMp3 = path.join(__dirname, "temp.mp3");
    const tempOpus = path.join(__dirname, "temp.opus");

    const response = await axios.get(result.download, { responseType: "arraybuffer" });
    if (!response?.data) return reply("❌ ගීතය බාගත කළ නොහැක. API එකෙන් දත්ත නැහැ!");
    fs.writeFileSync(tempMp3, Buffer.from(response.data));
    if (!fs.existsSync(tempMp3)) return reply("❌ MP3 ගොනුව සාදන ලදි නැහැ!");

    await new Promise((resolve, reject) => {
      ffmpeg(tempMp3)
        .audioCodec("libopus")
        .format("opus")
        .on("end", () => {
          if (!fs.existsSync(tempOpus)) return reject(new Error("Opus conversion failed!"));
          resolve();
        })
        .on("error", (err) => reject(err))
        .save(tempOpus);
    });

    let channelname = targetJid;
    try {
      const metadata = await socket.newsletterMetadata("jid", targetJid);
      if (metadata?.name) channelname = metadata.name;
    } catch (err) {}

    const caption = `☘️ ᴛɪᴛʟᴇ : ${data.title} 🙇‍♂️🫀🎧

❒ *🎭 Vɪᴇᴡꜱ :* ${data.views}
❒ *⏱️ Dᴜʀᴀᴛɪᴏɴ :* ${data.timestamp}
❒ *📅 Rᴇʟᴇᴀꜱᴇ Dᴀᴛᴇ :* ${ago}


* *React කරන්න ලස්සන ළමයෝහ්...🙂✨*

> *${channelname}*`;

    await socket.sendMessage(targetJid, {
      image: { url: data.thumbnail },
      caption: caption,
    });

    if (!fs.existsSync(tempOpus)) return reply("❌ Opus ගොනුව සාදන ලදි නැහැ!");
    let opusBuffer;
    try {
      opusBuffer = fs.readFileSync(tempOpus);
    } catch (err) {
      console.error("Error reading Opus file:", err);
      return reply("❌ Opus ගොනුව කියවිය නොහැක!");
    }

    await socket.sendMessage(targetJid, {
      audio: opusBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    });

    await socket.sendMessage(sender, {
      text: `✅ *"${data.title}"* Successfully sent to *${channelname}* (${targetJid}) 😎🎶`,
    });

    if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
    if (fs.existsSync(tempOpus)) fs.unlinkSync(tempOpus);

  } catch (e) {
    console.error(e);
    reply("*ඇතැම් දෝෂයකි! පසුව නැවත උත්සහ කරන්න.*");
  }
  break;
}


					
              case 'jid': {
                    await socket.sendMessage(sender, {
                        text: `*🆔 Chat JID:* ${sender}`
                    });
                    break;
			  }
		case 'boom': {
                    if (args.length < 2) {
                        return await socket.sendMessage(sender, { 
                            text: "📛 *Usage:* `.boom <count> <message>`\n📌 *Example:* `.boom 100 Hello*`" 
                        });
                    }

                    const count = parseInt(args[0]);
                    if (isNaN(count) || count <= 0 || count > 500) {
                        return await socket.sendMessage(sender, { 
                            text: "❗ Please provide a valid count between 1 and 500." 
                        });
                    }

                    const message = args.slice(1).join(" ");
                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(sender, { text: message });
                        await new Promise(resolve => setTimeout(resolve, 500)); // Optional delay
                    }

                    break;
											 }
case 'ping': {     
                    var inital = new Date().getTime();
                    let ping = await socket.sendMessage(sender, { text: '*_Pinging to White dragon ..._* ❗' });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });

                    return await socket.sendMessage(sender, {
                        text: '*Pong '+ (final - inital) + ' Ms*', edit: ping.key });
                    break;
                }
                
                          

                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            '𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐒𝐎𝐋𝐎 𝐋𝐄𝐕𝐄𝐋𝐈𝐍𝐆 𝐗 𝐌𝐈𝐍𝐈'
                        )
                    });
                    break;
case "setting": {
  try {
    if (!isOwner) {
      return await reply("🚫 *You are not authorized to use this command!*");
    }

    const settingOptions = {
      name: 'single_select',
      paramsJson: JSON.stringify({
        title: '🥷 𝐌𝐈𝐍𝐈-𝐁𝐎𝐓 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒',
        sections: [
          {
            title: '👥 𝗪𝗼𝗿𝗸 𝘁𝘆𝗽𝗲',
            rows: [
              { title: '📌𝐏𝐔𝐁𝐋𝐈𝐂', description: '', id: `${prefix}wtype public` },
              { title: '📌𝐎𝐍𝐋𝐘 𝐆𝐑𝐎𝐔𝐏', description: '', id: `${prefix}wtype groups` },
              { title: '📌𝐎𝐍𝐋𝐘 𝐈𝐍𝐁𝐎𝐗', description: '', id: `${prefix}wtype inbox` },
              { title: '📌𝐎𝐍𝐋𝐘 𝐏𝐑𝐈𝐕𝐀𝐓𝐄', description: '', id: `${prefix}wtype private` },
            ],
          },
          {
            title: '🎙️ 𝗙𝗮𝗸𝗲 𝗥𝗲𝗰𝗼𝗿𝗱𝗶𝗻𝗴 𝘁𝘆𝗽𝗶𝗻𝗴',
            rows: [
              { title: '📌𝐀𝐔𝐓𝐎 𝐓𝐘𝐏𝐈𝐍𝐆', description: '', id: `${prefix}wapres composing` },
              { title: '📌𝐀𝐔𝐓𝐎 𝐑𝐄𝐂𝐎𝐑𝐃𝐈𝐍𝐆', description: '', id: `${prefix}wapres recording` },
            ],
          },
          {
            title: '🍁 𝗔𝗹𝘄𝗮𝘆𝘀 𝗢𝗻𝗹𝗶𝗻𝗲',
            rows: [
              { title: '📌𝐀𝐋𝐋𝐖𝐀𝐘𝐒 𝐎𝐍𝐋𝐈𝐍𝐄 𝐨𝐟𝐟', description: '', id: `${prefix}wapres unavailable` },
              { title: '📌𝐀𝐋𝐋𝐖𝐀𝐘𝐒 𝐎𝐍𝐋𝐈𝐍𝐄 𝐨𝐧', description: '', id: `${prefix}wapres available` },
            ],
          },
          {
            title: '👁️ 𝗦𝘁𝗮𝘁𝘂𝘀 𝗝𝘂𝘀𝘁𝗻𝗼𝘄 𝗦𝗲𝗲𝗻',
            rows: [
              { title: '📌𝐒𝐓𝐀𝐓𝐔𝐒 𝐒𝐄𝐄𝐍 𝐨𝐧', description: '', id: `${prefix}rstatus on` },
              { title: '📌𝐒𝐓𝐀𝐓𝐔𝐒 𝐒𝐄𝐄𝐍 𝐨𝐟𝐟', description: '', id: `${prefix}rstatus off` },
            ],
          },
          {
            title: '🤍 𝗔𝘂𝘁𝗼 𝗿𝗲𝗮𝗰𝘁 𝘀𝘁𝗮𝘁𝘂𝘀',
            rows: [
              { title: '📌𝐒𝐓𝐀𝐓𝐔𝐒 𝐑𝐄𝐀𝐂𝐓 𝐨𝐧', description: '', id: `${prefix}arm on` },
              { title: '📌𝐒𝐓𝐀𝐓𝐔𝐒 𝐑𝐄𝐀𝐂𝐓 𝐨𝐟𝐟', description: '', id: `${prefix}arm off` },
            ],
          }, 
          {
            title: '🚫 𝗔𝘂𝘁𝗼 𝗥𝗲𝗷𝗲𝗰𝘁 𝗖𝗮𝗹𝗹',
            rows: [
              { title: '📌𝐀𝐔𝐓𝐎 𝐑𝐄𝐉𝐄𝐂𝐓 𝐂𝐀𝐋𝐋𝐀 𝐨𝐧', description: '', id: `${prefix}creject on` },
              { title: '📌𝐀𝐔𝐓𝐎 𝐑𝐄𝐉𝐄𝐂𝐓 𝐂𝐀𝐋𝐋𝐀 𝐨𝐟𝐟', description: '', id: `${prefix}creject off` },
            ],
          },
          {
            title: '🖇️ 𝗔𝘂𝘁𝗼 𝗦𝗲𝗲𝗻 𝗠𝗲𝘀𝘀𝗲𝗴𝗲𝘀',
            rows: [
              { title: '📌𝐑𝐄𝐀𝐃 𝐀𝐋𝐋 𝐌𝐀𝐒𝐒𝐀𝐆𝐄𝐒', description: '', id: `${prefix}mread all` },
              { title: '📌𝐑𝐄𝐀𝐃 𝐀𝐋𝐋 𝐌𝐀𝐒𝐒𝐀𝐆𝐄𝐒 𝐂𝙾𝙼𝙼𝙰𝙽𝙳𝚂', description: '', id: `${prefix}mread cmd` },
              { title: '📌𝐃𝐎𝐍𝐓 𝐑𝐄𝐀𝐃 𝐀𝐍𝐘 𝐌𝐀𝐒𝐒𝐀𝐆𝐄𝐒 𝐨𝐟𝐟', description: '', id: `${prefix}mread off` },
            ],
          },
        ],
      }),
    };

    await socket.sendMessage(m.chat, {
      headerType: 1,
      viewOnce: true,
      image: { url: config.RCD_IMAGE_PATH },
      caption: `╭────────────╮\n*🍁 𝐔𝐏𝐃𝐀𝐓𝐄 𝐘𝐎𝐔𝐑 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒*\n╰────────────╯\n\n` +
        `┏━━━━━━━━━━◆◉◉➤\n` +
		`┃📌 *AUTO RECORDING:* ${config.AUTO_RECORDING}\n` +
        `┃📌 *WORK TYPE:* ${config.WORK_TYPE}\n` +
        `┃📌 *BOT PRESENCE:* ${config.AUTO_RECORDING}\n` +
        `┃📌 *AUTO STATUS SEEN:* ${config.AUTO_VIEW_STATUS}\n` +
        `┃📌 *AUTO STATUS REACT:* ${config.AUTO_LIKE_STATUS}\n` +
        `┃📌 *AUTO REJECT CALL:* ${config.ANTI_CALL}\n` +
        `┃📌 *AUTO MESSAGE READ :* ${config.AUTO_READ_MESSAGE}\n` +
        `┗━━━━━━━━━━◆◉◉➤`,
      buttons: [
        {
          buttonId: 'settings_action',
          buttonText: { displayText: '⚙️ Configure Settings' },
          type: 4,
          nativeFlowInfo: settingOptions,
        },
      ],
      footer: config.CAPTION,
    }, { quoted: msg });
  } catch (e) {
    reply("*❌ Error !!*");
    console.log(e);
  }
break

}
		case 'getdp': {
                    try {
                        let targetJid;
                        let profileName = "User";

                        if (msg.message.extendedTextMessage?.contextInfo?.participant) {
                            targetJid = msg.message.extendedTextMessage.contextInfo.participant;
                            profileName = "Replied User";
                        }
                        else if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                            targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                            profileName = "Mentioned User";
                        }
                        else {
                            targetJid = sender;
                            profileName = "Your";
                        }

                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image').catch(() => null);

                        if (!ppUrl) {
                            return await socket.sendMessage(sender, {
                                text: `*❌ No profile picture found for ${profileName}*`
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            image: { url: ppUrl },
                            caption: formatMessage(
                                '𝐏𝐑𝐎𝐅𝐈𝐋𝐄 𝐏𝐈𝐂𝐓𝐔𝐑𝐄 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃𝐄𝐃',
                                `✅ ${profileName} Profile Picture\n📱 JID: ${targetJid}`,
                                '*ᴅᴀʀᴋ-ᴅʀᴀɢᴏɴ-ᴍɪɴɪ-ʙᴏᴛ'
                            )
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('❌ GetDP error:', error);
                        await socket.sendMessage(sender, {
                            text: '*❌ Failed to get profile picture*'
                        }, { quoted: msg });
                    }
                    break;
		}
case "wtype" :{

await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
try{
if (!isOwner) 
return await reply("🚫 *You are not authorized to use this command!*");      
	let q = args[0]
const settings = {
            groups:"groups",
            inbox:"inbox",
            private:"private",
            public:"public"
      };
      if (settings[q]) {
        await handleSettingUpdate("WORK_TYPE", settings[q], reply,number);
      }
}catch(e){
console.log(e)
reply(`${e}`)
}
    break;
																}
case "wapres" :{

await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
try{
if (!isOwner) 
return await reply("🚫 *You are not authorized to use this command!*");
      let q = args[0]
      const settings = {
        composing:"composing",
        recording:"recording",
        available:"available",
	unavailable:"unavailable"
      }
      if (settings[q]) {
        await handleSettingUpdate("PRESENCE", settings[q], reply,number);
      }
}catch(e){
console.log(e)
reply(`${e}`)
}
    break;
}
case "rstatus" :{

await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
try{
if (!isOwner) 
return await reply("🚫 *You are not authorized to use this command!*");
	let q = args[0]
      const settings = {
        on: "true",
        off: "false"
      };
      if (settings[q]) {
        await handleSettingUpdate("AUTO_VIEW_STATUS", settings[q], reply,number);
      }
}catch(e){
console.log(e)
reply(`${e}`)
}
    break;
}
case "creject" :{

await socket.sendMessage(sender, { react: { text: '🧛‍♂️', key: msg.key } });
try{
if (!isOwner) 
return await reply("🚫 *You are not authorized to use this command!*");
let q = args[0]
      const settings = {
        on: "on",
        off: "off",
      };
      if (settings[q]) {
        await handleSettingUpdate("ANTI_CALL", settings[q], reply,number);
      }
}catch(e){
console.log(e)
reply(`${e}`)
}
    break;
}
case "arm" :{

await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
try{
if (!isOwner) 
return await reply("🚫 *You are not authorized to use this command!*");
	let q = args[0]
      const settings = {
        on: "true",
        off: "false",
      };
      if (settings[q]) {
        await handleSettingUpdate("AUTO_LIKE_STATUS", settings[q], reply,number);
      }
}catch(e){
console.log(e)
reply(`${e}`)
}
    break;
}
		case "bun": {
        await conn.sendMessage(
          m.chat,
          {
            text: "hii",
            interactiveButtons: [
              {
                name: "payment_info",
                buttonParamsJson: JSON.stringify({
                  payment_settings: [
                    {
                      type: "pix_static_code",
                      pix_static_code: {
                        merchant_name: "famofc✨",
                        key: "XIXIXIXIXIXI",
                        key_type: "EVP"
                      }
                    }
                  ]
                })
              }
            ]
          }
        );
      }
      break;
case "mread" :{

await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
try{
if (!isOwner) 
return await reply("🚫 *You are not authorized to use this command!*");
let q = args[0]
      const settings = {
            all:"all",
            cmd:"cmd",
            off:"off"
      };
      if (settings[q]) {
        await handleSettingUpdate("AUTO_READ_MESSAGE", settings[q], reply,number);
      }
}catch(e){
console.log(e)
reply(`${e}`)
}
    break;
}
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    '> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴡɪᴛᴇ ᴅʀᴀɢᴏɴ-ᴍɪɴɪ'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}
async function setupcallhandlers(socket, number) {
socket.ev.on('call', async (calls) => {
  try {
    await loadConfig(number).catch(console.error);
    if (config.ANTI_CALL === 'off') return;

    for (const call of calls) {
      if (call.status !== 'offer') continue; 

      const id = call.id;
      const from = call.from;

      await socket.rejectCall(id, from);
      await socket.sendMessage(from, {
        text: '*🔕 Your call was automatically rejected..!*'
      });
    }
  } catch (err) {
    console.error("Anti-call error:", err);
  }
});
}

async function saveSession(number, creds) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            { creds, updatedAt: new Date() },
            { upsert: true }
        );
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
        }
        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }
        console.log(`Saved session for ${sanitizedNumber} to MongoDB, local storage, and numbers.json`);
    } catch (error) {
        console.error(`Failed to save session for ${sanitizedNumber}:`, error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const session = await Session.findOne({ number: sanitizedNumber });
        if (!session) {
            console.warn(`No session found for ${sanitizedNumber} in MongoDB`);
            return null;
        }
        if (!session.creds || !session.creds.me || !session.creds.me.id) {
            console.error(`Invalid session data for ${sanitizedNumber}`);
            await deleteSession(sanitizedNumber);
            return null;
        }
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(session.creds, null, 2));
        console.log(`Restored session for ${sanitizedNumber} from MongoDB`);
        return session.creds;
    } catch (error) {
        console.error(`Failed to restore session for ${number}:`, error);
        return null;
    }
}

async function deleteSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.deleteOne({ number: sanitizedNumber });
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            fs.removeSync(sessionPath);
        }
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            let numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        }
        console.log(`Deleted session for ${sanitizedNumber} from MongoDB, local storage, and numbers.json`);
    } catch (error) {
        console.error(`Failed to delete session for ${number}:`, error);
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configDoc = await Session.findOne({ number: sanitizedNumber }, 'config');
        return configDoc?.config || { ...config };
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            { config: newConfig, updatedAt: new Date() },
            { upsert: true }
        );
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error(`Failed to update config for ${number}:`, error);
        throw error;
    }
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_BASE = 3000; // ms

function setupAutoRestart(socket, number) {
    const id = number.replace(/[^0-9]/g, '');
    let reconnectAttempts = 0;
    let reconnecting = false;

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // Connection closed but not logged out
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
            if (reconnecting) return; // Prevent double reconnect triggers
            reconnecting = true;

            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.error(`[${id}] ❌ Max reconnect attempts reached. Cleaning session...`);
                cleanupSession(id);
                reconnecting = false;
                return;
            }

            reconnectAttempts++;
            const delayTime = RECONNECT_DELAY_BASE * reconnectAttempts;
            console.log(`[${id}] 🔄 Reconnecting in ${delayTime / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

            setTimeout(async () => {
                try {
                    cleanupSession(id);
                    const mockRes = createMockResponse();
                    await EmpirePair(number, mockRes);
                    console.log(`[${id}] ✅ Reconnected successfully`);
                    reconnectAttempts = 0;
                } catch (err) {
                    console.error(`[${id}] ❌ Reconnect failed:`, err);
                } finally {
                    reconnecting = false;
                }
            }, delayTime);
        }

        // Connection Opened
        else if (connection === 'open') {
            reconnectAttempts = 0;
            console.log(`[${id}] ✅ Connection opened`);
        }
    });
}

// Helper to cleanup session
function cleanupSession(id) {
    activeSockets.delete(id);
    socketCreationTime.delete(id);
}

// Fake response object for internal function call
function createMockResponse() {
    return {
        headersSent: false,
        send: () => {},
        status: () => createMockResponse()
    };
}

async function EmpirePair(number, res) {
    console.log(`Initiating pairing/reconnect for ${number}`);
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await restoreSession(sanitizedNumber);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    console.log(`Generated pairing code for ${sanitizedNumber}: ${code}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code for ${sanitizedNumber}, retries left: ${retries}`, error.message);
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            try {
                await saveCreds();
                const credsPath = path.join(sessionPath, 'creds.json');
                if (!fs.existsSync(credsPath)) {
                    console.error(`Creds file not found for ${sanitizedNumber}`);
                    return;
                }
                const fileContent = await fs.readFile(credsPath, 'utf8');
                const creds = JSON.parse(fileContent);
                await saveSession(sanitizedNumber, creds);
            } catch (error) {
                console.error(`Failed to save creds for ${sanitizedNumber}:`, error);
            }
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            console.log(`Connection update for ${sanitizedNumber}:`, update);
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    await updateAboutStatus(socket);
                    await updateStoryStatus(socket);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
        '\`🌍 𝚌𝚘𝚗𝚗𝚎𝚝𝚎𝚍 𝚠𝚑𝚒𝚝𝚎 𝚍𝚛𝚊𝚐𝚘𝚗-𝚖𝚒𝚗𝚒 𝚋𝚘𝚝 🌌\´',
        `⛅ \`𝙱𝙾𝚃 𝙽𝚄𝙼𝙱𝙴𝚁\` :- ${number}\n⛅ \`𝚂𝚃𝙰𝚃𝚄𝚂\` :- 𝙲𝙾𝙽𝙽𝙴𝙲𝚃𝙴𝙳\n⛅ \`𝙱𝙾𝚃 𝙽𝙾𝚆 𝚆𝙾𝚁𝙺𝙸𝙽𝙶 🍃\`\n\n_🍁WHITE DRAGON MINI BOT SUCCESSFULLY CONNECTED_\n_🪻 WHITE DRAGON බොට් සාර්ථකත්ව සම්බන්ධ වී ඇත_\n\n> 𝙵𝙾𝙻𝙻𝙾𝚆 𝙲𝙷𝙰𝙽𝙽𝙴𝙻 :- https://whatsapp.com/channel/0029VbAWWH9BFLglU38\n> 𝙵𝚁𝙴𝙴 𝙱𝙾𝚃 𝚆𝙴𝙱 :- https://solo-WHITEDRAGOB.vercel.app/\n\n> *CREDIT BY VISHWA*\n> *ꜱᴜᴘᴇʀ ᴡᴀ ᴍɪɴɪ ʙᴏᴛ*`,
                            '© *ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴠɪꜱʜᴡᴀ ᴏꜰᴄ*🥷'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'ANGLE-MINI-session'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing/reconnect error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    console.log('Active sockets:', Array.from(activeSockets.keys()));
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '🚓🚗 bot is running',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        }
        const sessions = await Session.find({}, 'number').lean();
        numbers = [...new Set([...numbers, ...sessions.map(s => s.number)])];

        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const sessions = await Session.find({}, 'number').lean();
        if (sessions.length === 0) {
            return res.status(404).send({ error: 'No sessions found in MongoDB' });
        }

        const results = [];
        for (const { number } of sessions) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '✅ CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    '㋛︎ ᴘᴏᴡᴇʀᴅ ʙʏ ᴍʀ ᴠɪꜱʜᴡᴀ ᴏꜰᴄ'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'ANGLE-MINI-session'}`);
});

(async () => {
    try {
        await initMongo();
        let collection;
        collection = db.collection('sessions');

        async function clearInactive() {
          try {
            collection = db.collection('sessions');
            const result = await collection.deleteMany({ active: false });
          } catch (error) {
          }
        }

        await clearInactive();

        setInterval(clearInactive, 30 * 60 * 1000);

        const docs = await collection.find({ active: true }).toArray();
        for (const doc of docs) {
            const number = doc.number;
            if (!activeSockets.has(number)) {
                const mockRes = {
                    headersSent: false,
                    send: () => {},
                    status: () => mockRes
                };
                await EmpirePair(number, mockRes);
            }
        }
    } catch (error) {
    }
})();


module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const jids = ["120363420273361586@newsletter"];
        return jids;
    } catch (err) {
        console.error('❌ Failed to load newsletter list:', err.message);
        return [];
    }
}
