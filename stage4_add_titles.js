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
  CONFIGS,
  getVideoEncoder,
  buildVideoEncodeArgs,
  ffprobeDuration,
  runFfmpegWithProgress,
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
    '-map', '0:a:0'
  ];

  // Encoder + fps + progress
  const encoder = getVideoEncoder(true);
  args.push(...buildVideoEncodeArgs(encoder));
  args.push('-r', String(CONFIGS.fps_output));
  args.push('-progress', 'pipe:2', '-stats_period', String(CONFIGS.stats_period));

  args.push(
    '-c:a', 'copy',
    '-shortest',
    normalizePathForCli(relativePathForCli(OUTPUT_FILE))
  );

  console.log('FFmpeg (stage4) using script:', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)));
  const totalDuration = await ffprobeDuration(INPUTS.audio).catch(() => 0);
  await runFfmpegWithProgress(args, totalDuration, 'stage4');
  console.log(`Stage4 OK: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err.message || err); process.exit(1); }); 