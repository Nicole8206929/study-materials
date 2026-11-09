"use strict";
for (const button of document.querySelectorAll("button[data-copy-field]")) {
  button.addEventListener("click", async () => {
    const field = document.getElementById(button.dataset.copyField);
    const status = document.getElementById("installCopyStatus");
    if (!field || !status) return;
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = field.id === "installPageUrl"
        ? "已复制。现在打开手机桌面的 Firefox，把地址粘贴到地址栏。"
        : "已复制安装链接。在 Tampermonkey 的“从 URL 安装”中粘贴，无需复制代码。";
    } catch {
      field.focus(); field.select();
      status.textContent = "浏览器未允许自动复制。请长按已选中的地址，选择“复制”。";
    }
  });
}
