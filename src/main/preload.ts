import { contextBridge, ipcRenderer } from 'electron';

const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';

contextBridge.exposeInMainWorld('cv', {
  baseUrl: arg('cv-base'),
  token: arg('cv-token'),
  pluginPath: arg('cv-plugin'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  openFile: (root: string, rel: string): Promise<boolean> => ipcRenderer.invoke('open-file', root, rel),
});
