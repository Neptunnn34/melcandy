const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('melcandyDesktop', {
  version: '1.0.0'
});
