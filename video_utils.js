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
};

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;

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

async function ffprobeDuration(filePath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
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
  const missing = Object.entries(INPUTS)
    .filter(([, p]) => !fs.existsSync(p) && !p.endsWith('pictureDir'))
    .map(([k, p]) => `${k}: ${p}`);
  if (!fs.existsSync(INPUTS.pictureDir)) missing.push(`pictureDir: ${INPUTS.pictureDir}`);
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
  // Bảo toàn \N (newline trong ASS) bằng cách tách trước khi escape
  return t.split('\\N').map(part => part.replace(/[{}]/g, m => `\\${m}`)).join('\\N');
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
    // Alignment=4: middle-left; MarginL=40 để canh lề trái đối xứng ảnh; Fontsize=72 (x2)
    'Style: LeftDefault,Arial,64,&H00FFFFFF,&HFFFFFFFF,&H00111111,&H00000000,0,0,0,0,100,100,0,0,1,2,0,4,40,40,40,0',
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
      // Giới hạn ký tự mỗi dòng ~ 24 để đảm bảo vùng trái hẹp (đối xứng ảnh ~30% width)
      const partWrapped = wrapTextByChars(partRaw, 24);
      const start = cue.start + ((i - 1) / n) * duration;
      const end = cue.start + (i / n) * duration;
      const startAss = secondsToAssTime(start);
      const endAss = secondsToAssTime(end);
      // \an4: middle-left, \q2: wrap theo word boundary
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
  execCmd,
  ffprobeDuration,
  ensureOutputDir,
  validateInputs,
  parseTimelineSrt,
  listPicturesSequential,
  buildAssWithKaraoke,
  buildAssWordReveal,
}; 