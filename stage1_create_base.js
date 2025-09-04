#!/usr/bin/env node

const path = require('path');
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
} = require('./video_utils');

const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stage1_base.mp4');

function buildFilterGraph() {
  const filters = [];
  filters.push(
    `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${TARGET_WIDTH}:${TARGET_HEIGHT},` +
    `setsar=1,` +
    `fps=30[bg];`
  );
  filters.push(
    `[1:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `setsar=1,` +
    `format=rgba,chromakey=0x00ff00:0.30:0.10[gs];`
  );
  filters.push(`[bg][gs]overlay=(W-w)/2:(H-h)/2:format=auto[vout];`);
  return filters.join('');
}

async function tryRun(preferHardware, audioDuration) {
  const args = [
    '-y',
    '-hide_banner',
    '-r', '30',
    '-loop', '1', '-t', audioDuration.toFixed(3), '-i', INPUTS.backgroundImage,
    '-stream_loop', '-1', '-i', INPUTS.greenScreenVideo,
    '-filter_complex', buildFilterGraph(),
    '-map', '[vout]',
    '-an',
    '-shortest'
  ];

  if (preferHardware) {
    args.push(
      '-c:v', 'h264_videotoolbox',
      '-b:v', '6000k',
      '-maxrate', '8000k',
      '-bufsize', '16000k',
      '-pix_fmt', 'yuv420p',
      OUTPUT_FILE
    );
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-threads', '4',
      '-pix_fmt', 'yuv420p',
      OUTPUT_FILE
    );
  }

  console.log('FFmpeg args (stage1):');
  // console.log(args.join(' '));
  let = _args = [
    "-stream_loop", "-1",

    "-i", INPUTS.greenScreenVideo,
    '-loop', '1',

    "-i", INPUTS.backgroundImage,

    "-filter_complex", "[0:v]colorkey=0x00FF00:0.3:0.1[fg];[1:v][fg]scale2ref[bg][fgs];[bg][fgs]overlay=format=auto",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-t", audioDuration.toFixed(0),
    "-an",
    '-y',
    OUTPUT_FILE
  ];
  console.log(_args)
  await execCmd(ffmpegPath, _args);
}

async function run() {
  validateInputs();
  ensureOutputDir();
  const audioDuration = await ffprobeDuration(INPUTS.audio);
  console.log("audioDuration")

  try {
    await tryRun(true, audioDuration);
    console.log(`Stage1 OK (HW): ${OUTPUT_FILE}`);
  } catch (e) {
    console.warn('Stage1: HW encode failed, fallback x264...');
    await tryRun(false, audioDuration);
    console.log(`Stage1 OK (SW): ${OUTPUT_FILE}`);
  }
}

run().catch(err => { console.error(err.message || err); process.exit(1); }); 