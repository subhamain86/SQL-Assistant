## Admin message — quick guide (V17.5.1)

### Publish (administrator)
1. **Settings → Synchronization → Admin message.**
2. Type the message (up to **140 characters**, plain text) and choose **Information** or **Warning**.
3. Press **Publish message**. It is written to `sql-assistant-data/messages/admin-message.json` in the configured repository and shown at once on your own device.
4. To remove it from every device press **Clear message on all devices**.

> The repository file is **not encrypted**. Never put passwords, tokens or passphrases in the message — the app refuses text that looks like a credential.

### What other users see
A slim row at the bottom of the navbar: **Message from the administrator** (or **Warning from the administrator**) and the text. It appears when SQL Assistant starts, when the tab becomes active again, at the scheduled background synchronization and when the user presses **Sync with GitHub Now**. The **×** hides it on that device only; a new message appears again.

### Good to know
| Situation | What happens |
|---|---|
| Administrator is offline when publishing | Saved on that device, shown there, result says *"could not be published yet"*; published automatically at the next synchronization |
| A user is offline | The message already on screen stays; new messages arrive when the device is online again |
| The repository is not configured on a device | The device can still show a message it already has; publishing from it stays local and says how to connect |
| Two administrators publish | The newer message wins |
| A message is cleared while a device is offline | The device receives the clear later; the message does not come back |
| HTML, scripts or web addresses in the text | Shown as plain text, never as a link |

### File format (`sqla-admin-message` v1)
`{ format, formatVersion, id, active, text, level ("info" | "warning"), updatedAt, updatedByDevice, appVersion }`. A cleared message keeps the record with `active:false` and no text.
