export function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return '—';
  const value = Number(bytes);
  if (value < 1000) return `${value} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let size = value / 1000;
  let unit = units[0];
  for (let index = 1; size >= 1000 && index < units.length; index += 1) {
    size /= 1000;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '—';
  const total = Math.round(Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remainder}s`;
}

export function assetSummary(asset) {
  const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : '';
  return {
    id: asset.id,
    filename: asset.filename,
    state: asset.state,
    progress: `${Number(asset.progress_percent || 0)}%`,
    size: formatBytes(asset.file_size),
    duration: formatDuration(asset.duration_seconds),
    dimensions,
    created: asset.created_at,
    error: asset.error_msg || undefined,
  };
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printTable(rows, columns, emptyMessage = 'No results found.') {
  if (!rows.length) {
    process.stdout.write(`${emptyMessage}\n`);
    return;
  }
  const widths = columns.map((column) => Math.max(column.label.length, ...rows.map((row) => String(row[column.key] ?? '').length)));
  const line = (values) => values.map((value, index) => String(value ?? '').padEnd(widths[index])).join('  ');
  process.stdout.write(`${line(columns.map((column) => column.label))}\n`);
  process.stdout.write(`${widths.map((width) => '─'.repeat(width)).join('  ')}\n`);
  for (const row of rows) process.stdout.write(`${line(columns.map((column) => row[column.key] ?? ''))}\n`);
}
