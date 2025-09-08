#!/usr/bin/env node

const path = require('path');
const { OUTPUT_DIR, INPUTS, ffmpegPath, execCmd, ensureOutputDir, normalizePathForCli } = require('./video_utils');

const INPUT_VIDEO = path.join(OUTPUT_DIR, 'stage1_base.mp4');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stage2_with_audio.mp4');

async function run() {
  ensureOutputDir();
  const args = [
    '-y',
    '-hide_banner',
    '-i', normalizePathForCli(INPUT_VIDEO),
    '-i', normalizePathForCli(INPUTS.audio),
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    normalizePathForCli(OUTPUT_FILE)
  ];
  console.log('FFmpeg args (stage2):');
  console.log(args.join(' '));
  await execCmd(ffmpegPath, args);
  console.log(`Stage2 OK: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err.message || err); process.exit(1); }); 