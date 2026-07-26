# ClassPilot Canvas Companion

Canvas Companion sends the assignment or syllabus page that the student intentionally chooses to the ClassPilot workspace. It does not require a Canvas Developer Key.

## Install From This Repository

1. Download and extract `ClassPilot-Canvas-Companion.zip`.
2. Open `chrome://extensions` in desktop Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Pin **ClassPilot Canvas Companion** to the toolbar.

## Use

1. Sign into the school's Canvas site normally.
2. Open one assignment, rubric, or syllabus page.
3. Select the ClassPilot extension icon.
4. Review the detected course, title, due date, and points.
5. Select **Add to ClassPilot**.

ClassPilot opens the imported course automatically. Capturing the same Canvas assignment again updates its official details and preserves completed ClassPilot checklist items.

## Permissions And Privacy

- `activeTab` grants temporary access only to the current tab after the student selects the extension.
- `scripting` runs the bounded Canvas page reader after that explicit action.
- `storage` keeps only transient extension UI state needed to recover from an interrupted popup.
- Worker host access sends the approved capture to the ClassPilot one-time handoff endpoint.

The extension does not read or transmit Canvas passwords, SSO credentials, MFA codes, cookies, or personal access tokens. It removes scripts, forms, navigation, hidden fields, and unrelated page chrome from the capture. A capture is stored for at most ten minutes and can be redeemed once.

Uninstalling the extension removes its browser-managed extension data. Imported ClassPilot data can be deleted from the course or cleared from the Data view.

## Limits

- Desktop Chrome and compatible Chromium browsers are supported in this release.
- The student must open the Canvas page they want to import.
- Canvas layout changes may require a parser update.
- Mobile users can continue using ClassPilot screenshot, PDF, Office document, and text import.
