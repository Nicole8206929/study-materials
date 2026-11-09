// Screen Wake Lock reduces interruptions while the page is visible. The OS
// still controls background execution; no lock can keep a suspended tab alive.
export function screenActivity({request, visible, notify}) {
  let active = false, lock = null, pending = null, generation = 0;
  function release() {
    const held = lock; lock = null;
    if (held) Promise.resolve(held.release()).catch(() => {});
  }
  function update() {
    const current = ++generation;
    if (!active) { release(); notify(''); return; }
    if (!visible()) {
      release(); notify('已切到后台，系统可能暂停处理；当前选择保留，返回后继续。'); return;
    }
    if (lock && !lock.released) { notify('处理期间已请求保持亮屏。'); return; }
    if (!request) { notify('浏览器未提供保持亮屏功能；返回前台后会继续处理。'); return; }
    notify('正在处理；如切到后台，返回后会继续。');
    if (pending) return;
    pending = Promise.resolve().then(request).then(held => {
      if (current !== generation || !active || !visible()) { Promise.resolve(held.release()).catch(() => {}); return; }
      lock = held;
      held.addEventListener('release', () => {
        if (lock !== held) return;
        lock = null;
        if (active && visible()) notify('系统已解除保持亮屏；回到前台后继续处理。');
      }, {once:true});
      notify('处理期间已请求保持亮屏。');
    }).catch(() => {
      if (current === generation && active) notify('系统未允许保持亮屏；返回前台后会继续处理。');
    }).finally(() => {
      pending = null;
      // A hide/show or a new task may arrive while the request is pending.
      if (current !== generation && active && visible()) update();
    });
  }
  return {setActive(value) { if (active !== value) { active = value; update(); } }, update};
}
