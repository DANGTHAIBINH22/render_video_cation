#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const {
  OUTPUT_DIR,
  INPUTS,
  ffmpegPath,
  execCmd,
  ensureOutputDir,
  parseTimelineSrt,
  buildAssWordReveal,
  FONTS_DIR,
  escapePathForFilter,
  normalizePathForCli,
  relativePathForCli,
} = require('./video_utils');

const INPUT_VIDEO = path.join(OUTPUT_DIR, 'stage3_with_images.mp4');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'final_stages.mp4');
const OUTPUT_ASS = path.join(OUTPUT_DIR, 'timeline_word_reveal.ass');
const FILTER_SCRIPT = path.join(OUTPUT_DIR, 'stage4_filter.txt');

async function run() {
  ensureOutputDir();
  const timeline = parseTimelineSrt(INPUTS.timelineSrt);
  const assContent = buildAssWordReveal(timeline);
  fs.writeFileSync(OUTPUT_ASS, assContent, 'utf8');

  const escapedAss = escapePathForFilter(relativePathForCli(OUTPUT_ASS));
  const escapedFontsDir = escapePathForFilter(relativePathForCli(FONTS_DIR));

  // Ghi filter script
  const filterGraph = `subtitles='${escapedAss}':fontsdir='${escapedFontsDir}'[vout]`;
  fs.writeFileSync(FILTER_SCRIPT, filterGraph, 'utf8');

  const args = [
    '-y',
    '-hide_banner',
    '-i', normalizePathForCli(relativePathForCli(INPUT_VIDEO)),
    '-filter_complex_script', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)),
    '-map', '[vout]',
    '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'copy',
    '-shortest',
    normalizePathForCli(relativePathForCli(OUTPUT_FILE))
  ];

  console.log('FFmpeg (stage4) using script:', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)));
  await execCmd(ffmpegPath, args);
  console.log(`Stage4 OK: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err.message || err); process.exit(1); }); 