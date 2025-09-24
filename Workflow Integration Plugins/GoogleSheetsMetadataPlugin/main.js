const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { google } = require('googleapis');
const WorkflowIntegration = require('./WorkflowIntegration.node');

const PLUGIN_ID = 'com.blackmagicdesign.resolve.googlesheetsmetadata';

let mainWindow = null;
let resolveObj = null;
let projectManagerObj = null;
let mediaPoolObj = null;

function debugLog(message) {
    if (mainWindow?.webContents) {
        const safeMessage = message.replace(/'/g, "\'");
        mainWindow.webContents.executeJavaScript(`console.log('%cMAIN:', 'color: #4fc3f7', '${safeMessage}')`);
    }
}

async function initResolveInterface() {
    const isSuccess = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!isSuccess) {
        debugLog('Failed to initialize Resolve interface');
        return null;
    }

    const resolveInterface = await WorkflowIntegration.GetResolve();
    if (!resolveInterface) {
        debugLog('Failed to acquire Resolve object');
        return null;
    }

    return resolveInterface;
}

async function cleanupResolveInterface() {
    try {
        await WorkflowIntegration.CleanUp();
    } catch (error) {
        debugLog(`Cleanup error: ${error.message}`);
    }

    resolveObj = null;
    projectManagerObj = null;
    mediaPoolObj = null;
    return true;
}

async function getResolve() {
    if (!resolveObj) {
        resolveObj = await initResolveInterface();
    }
    return resolveObj;
}

async function getProjectManager() {
    if (!projectManagerObj) {
        const resolve = await getResolve();
        if (!resolve) return null;
        projectManagerObj = await resolve.GetProjectManager();
    }
    return projectManagerObj;
}

async function getCurrentProject() {
    const projectManager = await getProjectManager();
    if (!projectManager) return null;
    return await projectManager.GetCurrentProject();
}

async function getMediaPool() {
    if (!mediaPoolObj) {
        const currentProject = await getCurrentProject();
        if (!currentProject) return null;
        mediaPoolObj = await currentProject.GetMediaPool();
    }
    return mediaPoolObj;
}

async function pickCredentialsFile() {
    const result = await dialog.showOpenDialog({
        title: 'Select Google service account credentials',
        buttonLabel: 'Select',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    return result.canceled ? null : result.filePaths[0];
}

async function loadSheetPreview(event, config) {
    try {
        const auth = await buildGoogleClient(config?.credentialsPath);
        const sheetData = await readSheetValues(auth, config?.spreadsheetId, config?.range);
        return { success: true, headers: sheetData.headers, rows: sheetData.rows };
    } catch (error) {
        debugLog(`loadSheetPreview error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function applySheetMetadata(event, payload) {
    const { filenameColumn, mappings, rows } = payload || {};

    if (!filenameColumn || !Array.isArray(mappings) || mappings.length === 0 || !Array.isArray(rows)) {
        return { success: false, error: 'Missing filename column, mappings, or row data.' };
    }

    const mediaPool = await getMediaPool();
    if (!mediaPool) {
        return { success: false, error: 'Unable to access Resolve media pool. Open a project and try again.' };
    }

    const rootFolder = await mediaPool.GetRootFolder();
    if (!rootFolder) {
        return { success: false, error: 'Unable to access root media pool folder.' };
    }

    const stats = {
        totalRows: rows.length,
        matched: 0,
        updated: 0,
        missing: 0,
        failedAssignments: 0
    };

    const missingClips = [];
    const failures = [];

    for (const row of rows) {
        const filenameRaw = (row[filenameColumn] || '').toString().trim();
        if (!filenameRaw) {
            stats.missing += 1;
            missingClips.push({ filename: '(blank filename)' });
            continue;
        }

        const clip = await findClipByFilename(rootFolder, filenameRaw);
        if (!clip) {
            stats.missing += 1;
            missingClips.push({ filename: filenameRaw });
            continue;
        }

        stats.matched += 1;
        let appliedToClip = false;

        for (const mapping of mappings) {
            const { column, metadataKey } = mapping;
            if (!metadataKey) continue;
            const valueRaw = row[column];
            if (valueRaw === undefined || valueRaw === null) continue;
            const value = valueRaw.toString().trim();
            if (!value) continue;

            try {
                const success = await clip.SetMetadata(metadataKey, value);
                if (!success) {
                    stats.failedAssignments += 1;
                    failures.push({ filename: filenameRaw, metadataKey, error: 'Resolve rejected value' });
                } else {
                    appliedToClip = true;
                }
            } catch (error) {
                stats.failedAssignments += 1;
                failures.push({ filename: filenameRaw, metadataKey, error: error.message });
            }
        }

        if (appliedToClip) {
            stats.updated += 1;
        }
    }

    return { success: true, stats, missingClips, failures };
}

async function buildGoogleClient(credentialsPath) {
    if (!credentialsPath) {
        throw new Error('Credentials path is required.');
    }

    let content;
    try {
        content = await fs.readFile(credentialsPath, 'utf-8');
    } catch (error) {
        throw new Error(`Unable to read credentials file: ${error.message}`);
    }

    let credentials;
    try {
        credentials = JSON.parse(content);
    } catch (error) {
        throw new Error('Credentials file is not valid JSON.');
    }

    const clientEmail = credentials.client_email;
    if (!clientEmail) {
        throw new Error('Credentials file is missing client_email.');
    }

    let privateKey = credentials.private_key;
    if (!privateKey) {
        throw new Error('Credentials file is missing private_key.');
    }

    privateKey = privateKey.replace(/\\n/g, '\n');

    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
    const auth = new google.auth.JWT(clientEmail, undefined, privateKey, scopes);
    await auth.authorize();
    return auth;
}

async function readSheetValues(auth, spreadsheetId, range) {
    if (!spreadsheetId) throw new Error('Spreadsheet ID is required.');
    if (!range) throw new Error('Range is required.');

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = response.data.values || [];

    if (!values.length) {
        return { headers: [], rows: [] };
    }

    const headers = values[0].map((header) => (header || '').toString().trim());
    const rows = values.slice(1).map((row) => rowArrayToObject(headers, row));

    return { headers, rows };
}

function rowArrayToObject(headers, row) {
    const entry = {};
    headers.forEach((header, index) => {
        if (!header) return;
        entry[header] = row[index] !== undefined ? row[index] : '';
    });
    return entry;
}

function normaliseFilename(filename) {
    return filename.trim().toLowerCase();
}

function stripExtension(value) {
    const index = value.lastIndexOf('.');
    return index === -1 ? value : value.substring(0, index);
}

async function findClipByFilename(rootFolder, filename) {
    const target = normaliseFilename(filename);
    const targetNoExt = stripExtension(target);
    const foldersToVisit = [rootFolder];

    while (foldersToVisit.length > 0) {
        const folder = foldersToVisit.pop();
        const clipList = await folder.GetClipList();
        if (clipList) {
            for (const clip of clipList) {
                const fileNameProp = await clip.GetClipProperty('File Name');
                const clipNameProp = await clip.GetClipProperty('Clip Name');
                if (matchesTarget(fileNameProp, target, targetNoExt) || matchesTarget(clipNameProp, target, targetNoExt)) {
                    return clip;
                }
            }
        }

        const subFolders = await folder.GetSubFolderList();
        if (subFolders) {
            foldersToVisit.push(...subFolders);
        }
    }

    return null;
}

function matchesTarget(candidate, target, targetNoExt) {
    if (!candidate) return false;
    const comparison = normaliseFilename(candidate);
    if (comparison === target) return true;
    return stripExtension(comparison) === targetNoExt;
}

function registerHandlers() {
    ipcMain.handle('resolve:pickCredentialsFile', pickCredentialsFile);
    ipcMain.handle('resolve:loadSheetPreview', loadSheetPreview);
    ipcMain.handle('resolve:applySheetMetadata', applySheetMetadata);
    ipcMain.handle('resolve:cleanupResolveInterface', cleanupResolveInterface);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 920,
        height: 760,
        useContentSize: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.on('close', () => {
        app.quit();
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    registerHandlers();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
