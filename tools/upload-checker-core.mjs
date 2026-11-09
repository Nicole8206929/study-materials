import {createFileHasher, checkAbort} from './file-hash.mjs';

export const MAX_BYTES = 2 * 1024 ** 3;

function decode(value) {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value) || value.length > 300000) throw new Error('链接或核对记录损坏。');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export async function decryptSnapshot(envelope, secret) {
  try {
    if (envelope.version !== 1) throw new Error('version');
    const keyBytes = decode(secret), iv = decode(envelope.iv);
    if (keyBytes.length !== 32 || iv.length !== 12) throw new Error('key');
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, key, decode(envelope.data));
    return validateSnapshot(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new Error('私人核对链接不完整或记录损坏。请从聊天重新打开完整链接，不能据此判断缺失文件。');
  }
}

export function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Number.isFinite(Date.parse(snapshot.checkedAt)) ||
      !Number.isInteger(snapshot.expectedCount) || snapshot.expectedCount < 1 || snapshot.expectedCount > 1000 ||
      !Array.isArray(snapshot.uploaded) || snapshot.uploaded.length > 1000 || snapshot.uploaded.some(item =>
        !Number.isSafeInteger(item.size) || item.size < 1 || item.size >= MAX_BYTES || !/^[a-f0-9]{64}$/.test(item.sha256))) {
    throw new Error('已上传记录不完整，不能可靠核对；请返回聊天更新核对链接。');
  }
  return snapshot;
}

export async function planFiles(files, snapshot, {signal, progress} = {}) {
  validateSnapshot(snapshot);
  if (!files.length || files.length > 1000) throw new Error('请重新选择这批资料，最多支持 1000 份。');
  let completed = 0, activeIndex = 0;
  const totalBytes = files.reduce((sum, file) => sum + (Number.isSafeInteger(file.size) && file.size > 0 ? file.size : 0), 0);
  const hash = createFileHasher({signal, onBytes: (file, bytes) => progress?.({phase: 'checking',
    name: file.name, index: activeIndex, total: files.length, bytes: completed + bytes, totalBytes})});
  const rows = [], seen = new Set();
  for (const file of files) {
    checkAbort(signal);
    activeIndex = rows.length;
    if (!file.name || file.name.length > 255 || /[\/\\\x00-\x1f]/.test(file.name) ||
        !/\.(?:pdf|pptx?)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size >= MAX_BYTES) {
      rows.push({file, state: 'invalid', reason: '需为已完整保存的 PDF、PPT 或 PPTX，非空且小于 2 GiB。'});
      continue;
    }
    try {
      const sha256 = (await hash(file)).slice(7);
      const key = `${file.size}:${sha256}`;
      const uploaded = snapshot.uploaded.some(item => item.size === file.size && item.sha256 === sha256);
      rows.push({file, sha256, state: uploaded ? 'uploaded' : seen.has(key) ? 'duplicate' : 'missing'});
      seen.add(key);
    } catch {
      checkAbort(signal);
      rows.push({file, state: 'invalid', reason: '无法读取，请先把文件完整保存到手机后重新选择。'});
    }
    completed += file.size;
  }
  checkAbort(signal);
  return {rows};
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

async function fileCRC(file, signal, progress) {
  let crc = 0xffffffff, lastYield = performance.now();
  for (let offset = 0; offset < file.size; offset += 256 * 1024) {
    checkAbort(signal);
    const bytes = new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
    checkAbort(signal);
    if (bytes.length !== Math.min(256 * 1024, file.size - offset)) throw new Error('文件未完整读出，请重新保存原件。');
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    progress?.(Math.min(offset + bytes.length, file.size));
    if (performance.now() - lastYield > 40) {
      await new Promise(resolve => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createUploadZip(plan, {maxBytes = MAX_BYTES, signal, progress} = {}) {
  if (!plan?.rows?.length || plan.rows.some(row => row.state === 'invalid')) throw new Error('有文件未能核对，不能生成补传包。');
  const missing = plan.rows.filter(row => row.state === 'missing');
  if (!missing.length) throw new Error('没有需要补传的文件。');
  const names = missing.map((row, index) => new TextEncoder().encode(`资料/${String(index + 1).padStart(4, '0')}/${row.file.name}`));
  const bytes = missing.reduce((sum, row, index) => sum + row.file.size + 76 + 2 * names[index].length, 22);
  if (bytes >= maxBytes || bytes >= MAX_BYTES) throw new Error('补传包超过单个附件的 2 GiB 限制，请回聊天安排分包。');
  const parts = [], central = [];
  let offset = 0, completed = 0;
  const totalBytes = missing.reduce((sum, row) => sum + row.file.size, 0);
  for (let index = 0; index < missing.length; index++) {
    checkAbort(signal);
    const {file} = missing[index], name = names[index];
    const crc = await fileCRC(file, signal, count => progress?.({phase: 'packing', name: file.name,
      index, total: missing.length, bytes: completed + count, totalBytes}));
    const date = new Date(file.lastModified || Date.now());
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >>> 1);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, file.size, true); h.setUint32(22, file.size, true); h.setUint16(26, name.length, true);
    const record = new Uint8Array(46), c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, file.size, true); c.setUint32(24, file.size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    // Blob keeps the selected File as a part instead of copying it into a
    // whole-archive ArrayBuffer on memory-constrained phones.
    parts.push(header, name, file); central.push(record, name);
    offset += header.length + name.length + file.size;
    completed += file.size;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, missing.length, true); e.setUint16(10, missing.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  checkAbort(signal);
  return {count: missing.length, blob: new Blob([...parts, ...central, end], {type: 'application/zip'})};
}
