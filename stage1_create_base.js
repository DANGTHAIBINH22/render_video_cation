#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const {
  PROJECT_ROOT,
  OUTPUT_DIR,
  INPUTS,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  ffmpegPath,
  execCmd,
  ffprobeDuration,
  ensureOutputDir,
  validateInputs,
  FONTS_DIR,
  escapePathForFilter,
  buildTitleAss,
  normalizePathForCli,
  readKeyColorHex,
  relativePathForCli,
} = require('./video_utils');

const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stage1_base.mp4');
const OUTPUT_TITLE_ASS = path.join(OUTPUT_DIR, 'title_top.ass');
const FILTER_SCRIPT = path.join(OUTPUT_DIR, 'stage1_filter.txt');

function buildFilterGraph(escapedAss, escapedFontsDir, keyHex) {
  const filters = [];
  // Background branch + bake title ASS
  filters.push(
    `[1:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${TARGET_WIDTH}:${TARGET_HEIGHT},` +
    `setsar=1,` +
    `fps=30,` +
    `subtitles='${escapedAss}':fontsdir='${escapedFontsDir}'[bg];`
  );
  // Foreground branch: key -> split -> smooth alpha -> merge -> despill -> scale 1.5x
  filters.push(
    `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `setsar=1,` +
    `format=rgba,colorkey=${keyHex}:0.34:0.02[fgk];` +
    `[fgk]split[fgc][fga];` +
    `[fga]alphaextract,boxblur=3:2[mask];` +
    `[fgc][mask]alphamerge,despill=green:0.85,scale=iw*1:ih*1[fg];`

  );
  // Compose: center X, align bottom Y
  filters.push(`[bg][fg]overlay=(W-w)/2:H-h:format=auto[vout];`);
  return filters.join('');
}

async function tryRun(preferHardware, audioDuration, titleAssPath) {
  const escapedAss = escapePathForFilter(relativePathForCli(titleAssPath));
  const escapedFonts = escapePathForFilter(relativePathForCli(FONTS_DIR));
  const keyHex = readKeyColorHex();
  const filterGraph = buildFilterGraph(escapedAss, escapedFonts, keyHex);

  // Ghi filter script ra file
  fs.writeFileSync(FILTER_SCRIPT, filterGraph, 'utf8');

  const args = [
    '-y',
    '-hide_banner',
    // Input 0: green screen video (loop)
    '-stream_loop', '-1', '-i', normalizePathForCli(relativePathForCli(INPUTS.greenScreenVideo)),
    // Input 1: background image (loop)
    '-loop', '1', '-i', normalizePathForCli(relativePathForCli(INPUTS.backgroundImage)),
    // Compose qua script
    '-filter_complex_script', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)),
    // Map video out
    '-map', '[vout]',
    // Duration theo audio
    '-t', audioDuration.toFixed(3),
    // No audio ở stage 1
    '-an'
  ];

  const outPath = normalizePathForCli(relativePathForCli(OUTPUT_FILE));

  if (preferHardware && process.platform === 'darwin') {
    args.push(
      '-c:v', 'h264_videotoolbox',
      '-b:v', '6000k',
      '-maxrate', '8000k',
      '-bufsize', '16000k',
      '-pix_fmt', 'yuv420p',
      outPath
    );
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      outPath
    );
  }

  console.log('FFmpeg (stage1) using script:', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)));
  await execCmd(ffmpegPath, args);
}

async function run() {
  validateInputs();
  ensureOutputDir();

  // Build Title ASS from title.txt
  const titleText = fs.readFileSync(INPUTS.title, 'utf8');
  const titleAss = buildTitleAss(titleText);
  fs.writeFileSync(OUTPUT_TITLE_ASS, titleAss, 'utf8');

  const audioDuration = await ffprobeDuration(INPUTS.audio);
  console.log(`audioDuration: ${audioDuration.toFixed(3)}s`);

  try {
    await tryRun(true, audioDuration, OUTPUT_TITLE_ASS);
    console.log(`Stage1 OK (HW/SW): ${OUTPUT_FILE}`);
  } catch (e) {
    console.warn('Stage1: HW encode failed or unavailable, fallback x264...');
    await tryRun(false, audioDuration, OUTPUT_TITLE_ASS);
    console.log(`Stage1 OK (SW): ${OUTPUT_FILE}`);
  }
}

run().catch(err => { console.error(err.message || err); process.exit(1); }); 