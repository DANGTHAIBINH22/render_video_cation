#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const {
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
} = require('./video_utils');

const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stage1_base.mp4');
const OUTPUT_TITLE_ASS = path.join(OUTPUT_DIR, 'title_top.ass');

function buildFilterGraph(escapedAss, escapedFontsDir) {
  const filters = [];
  // Background branch + bake title ASS
  filters.push(
    `[1:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${TARGET_WIDTH}:${TARGET_HEIGHT},` +
    `setsar=1,` +
    `fps=30,` +
    `subtitles='${escapedAss}':fontsdir='${escapedFontsDir}'[bg];`
  );
  // Foreground (green screen) branch
  filters.push(
    `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `setsar=1,` +
    `format=rgba,chromakey=0x00ff00:0.30:0.10[fg];`
  );
  // Compose center
  filters.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto[vout];`);
  return filters.join('');
}

async function tryRun(preferHardware, audioDuration, titleAssPath) {
  const escapedAss = escapePathForFilter(titleAssPath);
  const escapedFonts = escapePathForFilter(FONTS_DIR);
  const filterGraph = buildFilterGraph(escapedAss, escapedFonts);
  const args = [
    '-y',
    '-hide_banner',
    // Input 0: green screen video (loop)
    '-stream_loop', '-1', '-i', normalizePathForCli(INPUTS.greenScreenVideo),
    // Input 1: background image (loop)
    '-loop', '1', '-i', normalizePathForCli(INPUTS.backgroundImage),
    // Compose
    '-filter_complex', filterGraph,
    // Map video out
    '-map', '[vout]',
    // Duration theo audio
    '-t', audioDuration.toFixed(3),
    // No audio ở stage 1
    '-an'
  ];

  const outPath = normalizePathForCli(OUTPUT_FILE);

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

  console.log('FFmpeg args (stage1):');
  console.log(args.join(' '));
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