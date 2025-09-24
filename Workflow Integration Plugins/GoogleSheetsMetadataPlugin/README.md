# Google Sheets Metadata Sync Workflow

Pull clip metadata from a Google Sheet and push it into the current DaVinci Resolve project. The workflow looks up media pool clips by filename and writes the selected sheet columns into Resolve metadata keys.

## Prerequisites
- Resolve 19.0 or newer with Workflow Integrations enabled.
- A Google Cloud project with a service account that has access to the target Google Sheet.
- The service account JSON credentials file stored locally on the workstation running Resolve.
- Node.js dependencies installed for the plugin directory (`npm install`).

## Sheet Layout
- Include a single header row in the selected range. Headers become the available column names inside the workflow UI.
- Provide at least one column that matches the Resolve clip filename (for example `File Name` or `Clip Name`). The match is case-insensitive and accepts names with or without the file extension.
- Additional columns can contain any metadata you want to apply. The header text is used as the default metadata key; you can change it in the UI before applying updates.

## Using the Workflow
1. Place this plugin folder in your Resolve Workflow Integrations directory (or run it in the sandboxed samples environment).
2. Install dependencies inside the plugin folder:
   ```bash
   npm install
   ```
3. Launch the workflow from Resolve.
4. In the UI:
   - Browse for the service account JSON.
   - Enter the spreadsheet ID (the long ID between `/d/` and `/edit` in the sheet URL).
   - Enter the range to read (include the header row, for example `Sheet1!A1:G`).
   - Click **Load Sheet** to fetch a preview.
   - Choose the filename column and enable the columns you want to write. Adjust metadata key names if required.
   - Click **Apply Metadata to Matching Clips**.
5. Review the status panel for a summary of updated clips, missing filenames, and any failed assignments.

## Tips
- Share the sheet with the service account email so it can read the data.
- Custom metadata keys must already exist in Resolve. If a key is missing or cannot be written, the workflow reports the failure and continues with the remaining assignments.
- You can re-run the workflow after updating the sheet; only clips found in the media pool are affected.
