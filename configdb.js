const fs = require("fs");
const path = require("path");

const configDir = path.join(__dirname, "configs");
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir);
}

const defaultConfigs = {
  ANTI_DELETE: "off",
  ANTI_CALL: "off",
  WORK_TYPE: "public",
  AUTO_VIEW_STATUS: "on",
  AUTO_REACT_STATUS: "on",
  PRESENCE: "available",
  AUTO_READ_MESSAGE: "off",
  AUTO_LIKE_EMOJI: ["💋", "🍬", "🫆", "💗", "🎈", "🎉", "🥳", "❤️", "🧫", "🐭"],
  PREFIX: ".",
  BUTTON: "on"
};

function getDbPath(name) {
  return path.join(configDir, name + ".json");
}

async function connectdb(name) {
  const filePath = getDbPath(name);
  if (!fs.existsSync(filePath)) {
    await initializeSettings(name);
  }
}

async function initializeSettings(name) {
  const filePath = getDbPath(name);
  fs.writeFileSync(filePath, JSON.stringify(defaultConfigs, null, 2));
}

async function input(key, value, name) {
  const filePath = getDbPath(name);
  let data = {};
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  data[key] = value;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function get(key, name) {
  const filePath = getDbPath(name);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data[key] || null;
  }
  return null;
}

async function getalls(name) {
  const filePath = getDbPath(name);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return null;
}

async function resetSettings(name) {
  await initializeSettings(name);
}

module.exports = {
  connectdb,
  input,
  get,
  getalls,
  resetSettings
};