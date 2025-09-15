#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const {
  OUTPUT_DIR,
  INPUTS,
  TARGET_WIDTH,
  ffmpegPath,
  execCmd,
  ensureOutputDir,
  parseTimelineSrt,
  listPicturesSequential,
  normalizePathForCli,
  relativePathForCli,
  CONFIGS,
  getVideoEncoder,
  buildVideoEncodeArgs,
  ffprobeDuration,
  runFfmpegWithProgress,
} = require('./video_utils');

const INPUT_VIDEO = path.join(OUTPUT_DIR, 'stage2_with_audio.mp4');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stage3_with_images.mp4');
const FILTER_SCRIPT = path.join(OUTPUT_DIR, 'stage3_filter.txt');
const MAP_FILE = path.join(OUTPUT_DIR, 'stage3_picture_map.txt');

function buildFilterGraph(timeline, pictureCount) {
  const filters = [];
  // Base label
  filters.push(`[0:v]fps=${CONFIGS.fps_output},setsar=1[base];`);
  let prev = 'base';
  const overlayMargin = 40;
  const rightBoxWidthPx = Math.round(TARGET_WIDTH * 0.30);

  for (let i = 0; i < timeline.length && i < pictureCount; i++) {
    const cue = timeline[i];
    const picLabel = `pic${i}`;
    const outLabel = `l${i}`;
    const inputIdx = 1 + i; // 0: video, 1..N: pictures
    filters.push(
      `[${inputIdx}:v]scale=${rightBoxWidthPx}:-1:force_original_aspect_ratio=decrease,format=rgba[${picLabel}];`
    );
    const enableExpr = `between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})`;
    const overlayX = `W-${overlayMargin}-w`;
    const overlayY = `(H-h)/2`;
    filters.push(
      `[${prev}][${picLabel}]overlay=${overlayX}:${overlayY}:enable='${enableExpr}':format=auto[${outLabel}];`
    );
    prev = outLabel;
  }

  // fix chỗ cuối: dùng null thay vì copy
  filters.push(`[${prev}]null[vout];`);
  return filters.join('');
}

async function run() {
  ensureOutputDir();
  const timeline = parseTimelineSrt(INPUTS.timelineSrt);
  const pictures = listPicturesSequential(INPUTS.pictureDir);
  const pictureInputs = timeline.map((_, i) => pictures[i]).filter(Boolean);

  // Ghi mapping để biết [k:v] là ảnh nào
  const lines = [];
  lines.push('Index (FFmpeg)\tStart\tEnd\tRelativePath');
  for (let i = 0; i < pictureInputs.length; i++) {
    const cue = timeline[i];
    const rel = normalizePathForCli(relativePathForCli(pictureInputs[i]));
    lines.push(`[${1 + i}:v]\t${cue.start.toFixed(3)}\t${cue.end.toFixed(3)}\t${rel}`);
  }
  fs.writeFileSync(MAP_FILE, lines.join('\n'), 'utf8');

  // Ghi filter script
  const filterComplex = buildFilterGraph(timeline, pictureInputs.length);
  fs.writeFileSync(FILTER_SCRIPT, filterComplex, 'utf8');

  const args = [
    '-y',
    '-hide_banner',
    '-i', normalizePathForCli(relativePathForCli(INPUT_VIDEO)),
  ];
  // loop ảnh vô hạn
  pictureInputs.forEach(p => args.push('-loop', '1', '-i', normalizePathForCli(relativePathForCli(p))));

  args.push(
    '-filter_complex_script', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)),
    '-map', '[vout]',
    '-map', '0:a:0'
  );

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

  console.log('FFmpeg (stage3) using script:', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)));
  console.log('Picture map written to:', normalizePathForCli(relativePathForCli(MAP_FILE)));

  const totalDuration = await ffprobeDuration(INPUTS.audio).catch(() => 0);
  await runFfmpegWithProgress(args, totalDuration, 'stage3');
  console.log(`Stage3 OK: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err.message || err); process.exit(1); });
