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
} = require('./video_utils');

const INPUT_VIDEO = path.join(OUTPUT_DIR, 'stage2_with_audio.mp4');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stage3_with_images.mp4');
const FILTER_SCRIPT = path.join(OUTPUT_DIR, 'stage3_filter.txt');

function buildFilterGraph(timeline, pictureCount) {
  const filters = [];
  // Base label
  filters.push(`[0:v]fps=30,setsar=1[base];`);
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
    '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'copy',
    '-shortest',
    normalizePathForCli(relativePathForCli(OUTPUT_FILE))
  );

  console.log('FFmpeg (stage3) using script:', normalizePathForCli(relativePathForCli(FILTER_SCRIPT)));
  await execCmd(ffmpegPath, args);
  console.log(`Stage3 OK: ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err.message || err); process.exit(1); });
