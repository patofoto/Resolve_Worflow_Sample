let cachedRows = [];
let cachedHeaders = [];

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('browseCredentials').addEventListener('click', browseForCredentials);
    document.getElementById('loadSheetBtn').addEventListener('click', loadSheet);
    document.getElementById('applyMetadataBtn').addEventListener('click', applyMetadata);
});

window.addEventListener('beforeunload', async () => {
    await window.resolveAPI.cleanupResolveInterface();
});

function setLog(message) {
    const log = document.getElementById('logOutput');
    log.value = message ? `${message}\n` : '';
    log.scrollTop = log.scrollHeight;
}

function appendLog(message) {
    const log = document.getElementById('logOutput');
    log.value += `${message}\n`;
    log.scrollTop = log.scrollHeight;
}

async function browseForCredentials() {
    try {
        const filePath = await window.resolveAPI.pickCredentialsFile();
        if (filePath) {
            document.getElementById('credentialsPath').value = filePath;
        }
    } catch (error) {
        appendLog(`Failed to open file picker: ${error.message}`);
    }
}

async function loadSheet() {
    setLog('Loading sheet…');
    cachedRows = [];
    cachedHeaders = [];
    toggleApplyButton(false);

    const credentialsPath = document.getElementById('credentialsPath').value.trim();
    const spreadsheetId = document.getElementById('spreadsheetId').value.trim();
    const range = document.getElementById('range').value.trim();

    if (!credentialsPath || !spreadsheetId || !range) {
        setLog('Please provide credentials path, spreadsheet ID, and range.');
        return;
    }

    try {
        const result = await window.resolveAPI.loadSheetPreview({ credentialsPath, spreadsheetId, range });
        if (!result?.success) {
            setLog(result?.error || 'Unable to read sheet.');
            return;
        }

        cachedRows = result.rows;
        cachedHeaders = result.headers;
        setLog(`Loaded ${result.rows.length} rows with ${result.headers.length} columns.`);
        populateMappingUI(result.headers);
    } catch (error) {
        setLog(`Error loading sheet: ${error.message}`);
    }
}

function populateMappingUI(headers) {
    const mappingSection = document.getElementById('mappingSection');
    const filenameSelect = document.getElementById('filenameColumn');
    const tableBody = document.querySelector('#mappingTable tbody');

    filenameSelect.innerHTML = '';
    tableBody.innerHTML = '';

    const usableHeaders = headers.filter((header) => header && header.trim().length > 0);
    if (usableHeaders.length === 0) {
        appendLog('No header row detected. Make sure the selected range includes headers.');
        mappingSection.classList.add('hidden');
        return;
    }

    usableHeaders.forEach((header) => {
        const option = document.createElement('option');
        option.value = header;
        option.textContent = header;
        filenameSelect.appendChild(option);
    });

    filenameSelect.value = guessFilenameHeader(usableHeaders);

    usableHeaders.forEach((header) => {
        const row = document.createElement('tr');
        row.dataset.column = header;

        const checkboxCell = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('column-toggle');
        checkbox.checked = header !== filenameSelect.value;
        checkboxCell.appendChild(checkbox);

        const columnNameCell = document.createElement('td');
        columnNameCell.textContent = header;

        const metadataKeyCell = document.createElement('td');
        const metadataInput = document.createElement('input');
        metadataInput.type = 'text';
        metadataInput.classList.add('metadata-key');
        metadataInput.value = header;
        metadataKeyCell.appendChild(metadataInput);

        row.appendChild(checkboxCell);
        row.appendChild(columnNameCell);
        row.appendChild(metadataKeyCell);

        tableBody.appendChild(row);
    });

    mappingSection.classList.remove('hidden');
    toggleApplyButton(true);
}

function guessFilenameHeader(headers) {
    const candidates = ['file name', 'filename', 'clip name', 'name'];
    const lowerHeaders = headers.map((h) => h.toLowerCase());
    for (const target of candidates) {
        const index = lowerHeaders.indexOf(target);
        if (index !== -1) return headers[index];
    }
    return headers[0];
}

function toggleApplyButton(enabled) {
    document.getElementById('applyMetadataBtn').disabled = !enabled;
}

async function applyMetadata() {
    if (!cachedRows.length) {
        appendLog('Load sheet data before applying metadata.');
        return;
    }

    const filenameColumn = document.getElementById('filenameColumn').value;
    if (!filenameColumn) {
        appendLog('Select the column that contains filenames.');
        return;
    }

    const mappings = [];
    const rows = document.querySelectorAll('#mappingTable tbody tr');
    rows.forEach((row) => {
        const header = row.dataset.column;
        const enabled = row.querySelector('.column-toggle').checked;
        const metadataKey = row.querySelector('.metadata-key').value.trim();
        if (enabled && metadataKey && header !== filenameColumn) {
            mappings.push({ column: header, metadataKey });
        }
    });

    if (!mappings.length) {
        appendLog('Enable at least one column to send to Resolve.');
        return;
    }

    toggleApplyButton(false);
    appendLog('Applying metadata…');

    try {
        const result = await window.resolveAPI.applySheetMetadata({
            filenameColumn,
            mappings,
            rows: cachedRows
        });

        if (!result?.success) {
            appendLog(result?.error || 'Failed to apply metadata.');
            toggleApplyButton(true);
            return;
        }

        const stats = result.stats;
        appendLog(`Updated ${stats.updated} clips. ${stats.missing} filenames not found. ${stats.failedAssignments} assignments failed.`);

        if (result.missingClips?.length) {
            appendLog('Missing clips:');
            result.missingClips.forEach((item) => appendLog(`  ${item.filename}`));
        }

        if (result.failures?.length) {
            appendLog('Failed assignments:');
            result.failures.forEach((item) => appendLog(`  ${item.filename} → ${item.metadataKey}: ${item.error}`));
        }
    } catch (error) {
        appendLog(`Error applying metadata: ${error.message}`);
    }

    toggleApplyButton(true);
}
