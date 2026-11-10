(function () {
  'use strict';
  var picker = document.getElementById('checkFiles');
  var status = document.getElementById('inventoryStatus');
  var retry = document.getElementById('retryInventory');
  var directPicker = document.getElementById('directFiles');
  if (directPicker) directPicker.addEventListener('change', function () {
    if (window.nicoleDirectUploaderStarted || !directPicker.files.length) return;
    var selected = window.nicoleDirectEarlyFiles || (window.nicoleDirectEarlyFiles = []);
    for (var j = 0; j < directPicker.files.length && selected.length < 1000; j++) selected.push(directPicker.files[j]);
    var count = document.getElementById('directSelectionCount');
    if (count) count.textContent = '已暂存选择 ' + selected.length + ' 份，正在准备上传设置。';
  });
  picker.disabled = false;
  picker.addEventListener('change', function () {
    if (window.nicoleUploadCheckerStarted || !picker.files.length) return;
    var early = window.nicoleUploadEarlyFiles || (window.nicoleUploadEarlyFiles = []);
    for (var i = 0; i < picker.files.length; i++) early.push(picker.files[i]);
    status.textContent = '已累计选择 ' + early.length + ' 份文件。核对工具仍在准备；现在不会上传或打包。';
  });
  retry.addEventListener('click', function () {
    if (!window.nicoleUploadCheckerStarted) location.reload();
  });
  setTimeout(function () {
    if (window.nicoleUploadCheckerStarted) return;
    var automation = document.getElementById('automationState');
    if (automation) automation.textContent = '上传工具未能启动。请刷新此页重试；尚未发送文件，也不会误报入库成功。';
    status.textContent = '核对工具未能启动，可能是脚本没载入或浏览器不兼容。所选文件尚未核对；点“重新载入记录”会刷新本页。';
  }, 12000);
})();
