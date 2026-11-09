export class FileSelection {
  entries = [];
  removed = [];
  nextID = 1;
  get files() { return this.entries.map(entry => entry.file); }
  get canUndo() { return this.removed.length > 0; }
  key(file) { return JSON.stringify([file.webkitRelativePath || '', file.name.normalize('NFC'), file.size, file.lastModified]); }
  add(files) {
    const next = this.entries.map(entry => ({...entry}));
    const known = new Map(next.map(entry => [entry.key, entry]));
    let nextID = this.nextID, added = 0, reused = 0;
    for (const file of files) {
      const key = this.key(file);
      if (known.has(key)) {
        // A metadata match is only a selection slot: keep the newly selected
        // File, whose content will still be hashed rather than assumed equal.
        known.get(key).file = file; reused++;
      } else {
        const entry = {id:nextID++, key, file};
        next.push(entry); known.set(key,entry); added++;
      }
      if (next.length > 1000) throw new Error('本页最多累计 1000 份，原有选择已保留；请少选一部分再添加。');
    }
    this.entries = next; this.nextID = nextID;
    return {added,reused,total:next.length};
  }
  remove(id) {
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index < 0) return false;
    this.removed = [{index, entry:this.entries[index]}];
    this.entries.splice(index,1);
    return true;
  }
  clear() {
    if (!this.entries.length) return;
    this.removed = this.entries.map((entry,index) => ({entry,index}));
    this.entries = [];
  }
  undo() {
    const known = new Set(this.entries.map(entry => entry.key));
    let restored = 0;
    for (const {entry,index} of this.removed) {
      if (known.has(entry.key)) continue;
      this.entries.splice(Math.min(index,this.entries.length),0,entry);
      known.add(entry.key); restored++;
    }
    this.removed = [];
    return restored;
  }
}
