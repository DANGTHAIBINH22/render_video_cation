const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const SrtParser = require('srt-parser-2').default;

const PROJECT_ROOT = __dirname;
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

const INPUTS = {
  backgroundImage: path.join(PROJECT_ROOT, 'Background Fame', 'FRAMEVIDEO.jpg'),
  greenScreenVideo: path.join(PROJECT_ROOT, 'backround_videos', 'FRAMEVIDEO.mp4'),
  audio: path.join(PROJECT_ROOT, 'audio', 'VoiceTXT.mp3'),
  timelineSrt: path.join(PROJECT_ROOT, 'Timeline.srt'),
  pictureDir: path.join(PROJECT_ROOT, 'Image Description'),
  title: path.join(PROJECT_ROOT, 'title.txt'),
  keyColorFile: path.join(PROJECT_ROOT, 'keycolor.txt'),
};

const FONTS_DIR = path.join(PROJECT_ROOT, 'Font');

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;

function safeNumber(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function loadConfigs() {
  const cfgPath = path.join(PROJECT_ROOT, 'configs.json');
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const json = JSON.parse(raw);
    return {
      title_top_size: safeNumber(json.title_top_size, 38),
      timeline_word_size: safeNumber(json.timeline_word_size, 30),
      title_margin_top: safeNumber(json.title_margin_top, 40),
      timeline_word_margin_left: safeNumber(json.timeline_word_margin_left, 40),
    };
  } catch (_) {
    return {
      title_top_size: 80,
      timeline_word_size: 30,
      title_margin_top: 40,
      timeline_word_margin_left: 40,
    };
  }
}

const CONFIGS = loadConfigs();

function execCmd(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', d => (stdout += d.toString()));
    p.stderr.on('data', d => (stderr += d.toString()));
    p.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`Command failed (${cmd}): ${stderr}`);
      error.stdout = stdout; error.stderr = stderr; error.code = code;
      reject(error);
    });
  });
}

function normalizePathForCli(p) {
  return p.replace(/\\/g, '/');
}

async function ffprobeDuration(filePath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    normalizePathForCli(filePath),
  ];
  const { stdout } = await execCmd(ffprobePath, args);
  const dur = parseFloat(stdout.trim());
  if (!Number.isFinite(dur)) throw new Error(`Không lấy được duration từ: ${filePath}`);
  return dur;
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function validateInputs() {
  const missing = [];
  const requiredFiles = [
    ['backgroundImage', INPUTS.backgroundImage],
    ['greenScreenVideo', INPUTS.greenScreenVideo],
    ['audio', INPUTS.audio],
    ['timelineSrt', INPUTS.timelineSrt],
    ['title', INPUTS.title],
  ];
  for (const [key, p] of requiredFiles) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      missing.push(`${key}: ${p}`);
    }
  }
  if (!fs.existsSync(INPUTS.pictureDir) || !fs.statSync(INPUTS.pictureDir).isDirectory()) {
    missing.push(`pictureDir: ${INPUTS.pictureDir}`);
  }
  if (missing.length) {
    throw new Error('Thiếu file/thư mục bắt buộc:\n' + missing.join('\n'));
  }
}

function listPicturesSequential(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files.map(f => path.join(dir, f));
}

function parseTimelineSrt(srtPath) {
  const content = fs.readFileSync(srtPath, 'utf8');
  const parser = new SrtParser();
  const cues = parser.fromSrt(content);
  return cues.map((c, idx) => ({
    index: idx,
    start: srtTimeToSeconds(c.startTime),
    end: srtTimeToSeconds(c.endTime),
    text: (c.text || '').replace(/\r/g, '').replace(/\n/g, ' '),
  })).filter(c => c.end > c.start);
}

function srtTimeToSeconds(t) {
  const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(t.trim());
  if (!m) return 0;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const ms = parseInt(m[4], 10);
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

function secondsToAssTime(s) {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${hh}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function escapeAssText(t) {
  // Bảo toàn \\N (newline trong ASS) bằng cách tách trước khi escape
  return t.split('\\N').map(part => part.replace(/[{}]/g, m => `\\${m}`)).join('\\N');
}

function escapePathForFilter(filePath) {
  // 1) Chuyển backslash -> slash
  let normalized = filePath.replace(/\\/g, '/');
  // 2) Nếu là Windows drive (D:/...), escape dấu ':' ngay sau drive letter
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.replace(/^([A-Za-z]):\//, '$1\\:/');
  }
  // 3) Escape dấu nháy đơn trong đường dẫn
  normalized = normalized.replace(/'/g, "\\'");
  return normalized;
}

function readKeyColorHex() {
  try {
    if (fs.existsSync(INPUTS.keyColorFile)) {
      const raw = fs.readFileSync(INPUTS.keyColorFile, 'utf8').trim();
      const m = raw.match(/^#?([0-9A-Fa-f]{6})$/);
      if (m) return '0x' + m[1].toUpperCase();
    }
  } catch (_) {}
  return '0x00FF00';
}

function buildTitleAss(titleText) {
  const fontSize = CONFIGS.title_top_size;
  const marginTop = CONFIGS.title_margin_top;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,Paytone One,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00111111,&H00000000,0,0,0,0,100,100,0,0,1,2,0,8,40,40,${marginTop},0`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const startAss = secondsToAssTime(0);
  const endAss = secondsToAssTime(24 * 3600); // đủ dài để cover toàn video
  const textEscaped = escapeAssText((titleText || '').trim());
  const events = [`Dialogue: 0,${startAss},${endAss},Title,,0,0,0,,{\\an8}${textEscaped}`];
  return header.concat(events).join('\n');
}

function buildAssWithKaraoke(timeline) {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,36,&H00FFFFFF,&HFFFFFFFF,&H00111111,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,40,40,40,0',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = [];
  for (const cue of timeline) {
    const duration = Math.max(0.01, cue.end - cue.start);
    const text = cue.text || '';
    if (!text.trim()) continue;
    const chars = Array.from(text);
    const totalCs = Math.max(1, Math.round(duration * 100));
    const perChar = Math.max(1, Math.round(totalCs / Math.max(1, chars.length)));
    const karaokeText = chars.map(ch => `{\\k${perChar}}${escapeAssText(ch)}`).join('');
    const startAss = secondsToAssTime(cue.start);
    const endAss = secondsToAssTime(cue.end);
    events.push(`Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${karaokeText}`);
  }
  return header.concat(events).join('\n');
}

function buildAssWordReveal(timeline) {
  const fontSize = CONFIGS.timeline_word_size;
  const marginLeft = CONFIGS.timeline_word_margin_left;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: LeftDefault,Alata-Regular,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00111111,&H00000000,0,0,0,0,100,100,0,0,1,2,0,4,${marginLeft},40,40,0`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  function wrapTextByChars(text, maxCharsPerLine) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const w of words) {
      if ((current + (current ? ' ' : '') + w).length > maxCharsPerLine) {
        if (current) lines.push(current);
        current = w;
      } else {
        current = current ? current + ' ' + w : w;
      }
    }
    if (current) lines.push(current);
    return lines.join('\\N'); // ASS newline
  }

  const events = [];
  for (const cue of timeline) {
    const duration = Math.max(0.01, cue.end - cue.start);
    const text = (cue.text || '').trim();
    if (!text) continue;
    const words = text.split(/\s+/);
    const n = words.length;
    for (let i = 1; i <= n; i++) {
      const partRaw = words.slice(0, i).join(' ');
      const partWrapped = wrapTextByChars(partRaw, 24);
      const start = cue.start + ((i - 1) / n) * duration;
      const end = cue.start + (i / n) * duration;
      const startAss = secondsToAssTime(start);
      const endAss = secondsToAssTime(end);
      const rendered = `{\\an4\\q2}` + escapeAssText(partWrapped);
      events.push(`Dialogue: 0,${startAss},${endAss},LeftDefault,,0,0,0,,${rendered}`);
    }
  }
  return header.concat(events).join('\n');
}

module.exports = {
  PROJECT_ROOT,
  OUTPUT_DIR,
  INPUTS,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  ffmpegPath,
  ffprobePath,
  FONTS_DIR,
  CONFIGS,
  execCmd,
  ffprobeDuration,
  ensureOutputDir,
  validateInputs,
  parseTimelineSrt,
  listPicturesSequential,
  buildAssWithKaraoke,
  buildAssWordReveal,
  escapePathForFilter,
  buildTitleAss,
  normalizePathForCli,
  readKeyColorHex,
}; 