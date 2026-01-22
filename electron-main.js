import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 850,
      minWidth: 1000,
      minHeight: 700,
      title: "Nano Banana Studio",
      backgroundColor: '#0d1117', // Match your dark theme
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false, // For simpler local file handling in this specific use case
        webSecurity: false // Optional: Helps with some local file fetching/CORS in standalone mode
      },
      autoHideMenuBar: true, // Hide the standard menu bar for a cleaner look
    })

    // In production, load the built HTML file
    if (app.isPackaged) {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    } else {
      // In dev, load localhost
      mainWindow.loadURL('http://localhost:5173')
    }
  }

  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}