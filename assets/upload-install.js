"use strict";
const copyStatus = document.getElementById("installCopyStatus");
const bookmarkStatus = document.getElementById("bookmarkLoadStatus");
const bookmarkField = document.getElementById("bookmarkAddress");
fetch("tools/github-upload-bookmark.txt", {cache: "no-cache"})
  .then(response => {
    if (!response.ok) throw new Error("unavailable");
    return response.text();
  })
  .then(text => {
    const value = text.trim();
    if (!value.startsWith("javascript:") || value.length < 1000 || value.length > 100000) throw new Error("invalid");
    bookmarkField.value = value;
    document.getElementById("copyBookmark").disabled = false;
    bookmarkStatus.textContent = "已准备好。复制后粘贴到“自动补传”书签的网址栏。";
  })
  .catch(() => {
    bookmarkStatus.textContent = "书签未加载，请刷新本页重试。此时不要整批上传。";
  });
for (const button of document.querySelectorAll("button[data-copy-field]")) {
  button.addEventListener("click", async () => {
    const field = document.getElementById(button.dataset.copyField);
    const status = copyStatus;
    if (!field || !status) return;
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = field.id === "bookmarkAddress"
        ? "已复制书签地址。到浏览器“书签／收藏”中，长按“自动补传” → 编辑，把网址替换成刚复制的内容。"
        : field.id === "installPageUrl"
          ? "已复制。打开手机自带浏览器，把本页地址粘贴到地址栏。"
          : "已复制扩展版安装地址。在 Tampermonkey 的“从 URL 安装”中粘贴。";
    } catch {
      field.hidden = false;
      document.querySelector(`label[for="${field.id}"]`)?.removeAttribute("hidden");
      field.focus(); field.select();
      status.textContent = "浏览器未允许自动复制。请长按已选中的地址，选择“复制”。";
    }
  });
}
document.getElementById("copyBrowserInfo").addEventListener("click", async () => {
  const text = JSON.stringify({version: "native-1", userAgent: navigator.userAgent,
    bookmarkLoaded: !document.getElementById("copyBookmark").disabled,
    bookmarkLength: bookmarkField.value.length, fileSlices: typeof Blob.prototype.slice === "function"});
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = "浏览器诊断已复制，可以发到聊天；不包含文件、密码或登录信息。";
  } catch {
    copyStatus.textContent = "请复制这段浏览器诊断：" + text;
  }
});
