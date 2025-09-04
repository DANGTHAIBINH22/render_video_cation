#!/usr/bin/env node

const path = require('path');
const {
  OUTPUT_DIR,
  INPUTS,
  ffmpegPath,
  execCmd,
  ensureOutputDir,
  parseTimelineSrt,
  buildAssWordReveal,
} = require('./video_utils');

const INPUT_VIDEO = path.join(OUTPUT_DIR, 'stage3_with_images.mp4');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'final_stages.mp4');
const OUTPUT_ASS = path.join(OUTPUT_DIR, 'timeline_word_reveal.ass');

async function run() {
  ensureOutputDir();
  const timeline = parseTimelineSrt(INPUTS.timelineSrt);
  const assContent = buildAssWordReveal(timeline);
  require('fs').writeFileSync(OUTPUT_ASS, assContent, 'utf8');

  const args = [
    '-y',
    '-hide_banner',
    '-i', INPUT_VIDEO,
    '-filter_complex', `subtitles='${OUTPUT_ASS.replace(/:/g, '\\:').replace(/'/g, "\\'")}'[vout]`,
    '-map', '[vout]',
    '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'copy',
    '-shortest',
    OUTPUT_FILE
  ];

  console.log('FFmpeg args (stage4):');
  console.log(args.join(' '));
  await execCmd(ffmpegPath, args);
  console.log(`Stage4 OK: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err.message || err); process.exit(1); }); 